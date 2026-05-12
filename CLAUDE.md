# CLAUDE.md — AI Context for whatsapp-cardapio

> Read this before exploring any source file. It covers architecture, all non-obvious decisions, and every significant bug that was already fixed.

---

## What this project is

A WhatsApp chatbot + web admin panel for a food delivery business. Customers place orders via WhatsApp conversations; the restaurant manages them through a browser panel. Built with Node.js, Baileys (WhatsApp Web API), SQLite, Express, Socket.io.

**Entry point**: `src/index.js` → starts `src/bot/connection.js` (bot) and `src/api/server.js` (HTTP server) concurrently.

---

## File responsibilities (one-line each)

```
src/index.js                  Boot: creates server then starts bot
src/bot/connection.js         Baileys socket lifecycle, QR, reconnect loop
src/bot/messageRouter.js      Routes incoming WA messages by session state
src/bot/sessionManager.js     In-memory per-user conversation state (Map)
src/bot/contactStore.js       LID → phone JID resolution (see LID section)
src/bot/handlers/
  welcomeHandler.js           Greets user, checks open hours, detects returning customers
  menuHandler.js              Category/item/extras browsing, cart display
  addressHandler.js           Collects and confirms delivery address
  paymentHandler.js           PIX (Mercado Pago), cash (change calc), card flows
src/api/server.js             Express + Socket.io setup, static admin files
src/api/routes/auth.js        POST /api/auth/login → JWT (12h)
src/api/routes/admin.js       CRUD: orders, menu (categories/items/extras), settings, stats
src/api/routes/webhook.js     POST /webhook/mercadopago → confirms PIX payment
src/database/db.js            better-sqlite3 singleton, exposes getSetting()
src/database/schema.sql       Table definitions + default settings seed data
src/services/notifier.js      Socket.io emitter + WhatsApp notifications to customer/admin
admin/index.html              Login page
admin/dashboard.html          Orders dashboard (real-time via Socket.io + 3s polling)
admin/menu.html               Menu CRUD
admin/settings.html           Business settings form
```

---

## Architecture decisions

### Session state (in-memory)
All conversation state lives in a `Map<jid, sessionObject>` in `sessionManager.js`. Sessions expire after 2h of inactivity. **There is no DB persistence for sessions** — server restart resets all in-flight conversations. This is intentional: conversations are short-lived and re-prompting on restart is acceptable.

### Single SQLite file
`data/cardapio.db` with WAL mode. `better-sqlite3` is synchronous — no `await` needed for DB calls. All schema is in `schema.sql`, applied at startup with `db.exec(fs.readFileSync(...))`.

### Admin auth
JWT stored in `localStorage`. The `ADMIN_PASSWORD` in `.env` can be plain text (most users) or a bcrypt hash (for security-conscious deployments). Login handler detects which format:
```js
const isBcryptHash = adminPassword.startsWith('$2');
const valid = isBcryptHash ? await bcrypt.compare(...) : password === adminPassword;
```
**Do not change this** — `bcrypt.compare(plaintext, plaintext)` returns `false`, not an error.

### Socket.io + polling hybrid (bot status)
The bot emits `bot_status` / `qr_code` events via Socket.io when connection state changes. But if the browser connects *after* those events fire, it would miss them. Two mitigations:
1. `notifier.init()` replays current status/QR to every new socket connection
2. `dashboard.html` polls `GET /api/admin/bot-status` every 3 seconds when status is not 'connected'

### notifier._sock lifecycle
`notifier.js` holds `_sock` (the Baileys socket). On reconnect, `connection.js` creates a **new** socket object. `notifier._sock` must be updated or all notifications silently fail. Fix: `notifier.updateSock(sock)` is called in the `connection === 'open'` handler.

---

## WhatsApp LID — the most important quirk

Recent WhatsApp versions send messages with `remoteJid` like `80586555318318@lid` instead of `5531984767651@s.whatsapp.net`. The LID is an internal identifier, **not** derivable from the phone number.

**How we handle it:**
1. `contactStore.js` listens to `contacts.upsert` / `contacts.update` Baileys events and builds a `Map<lid, phoneJid>`.
2. `messageRouter.js` calls `resolveJid(rawJid)` before doing anything with the JID — returns the real `@s.whatsapp.net` JID when known, otherwise returns the LID unchanged (Baileys can route messages to LID JIDs too).
3. Orders store whatever JID was used at order time. `notifier.js` and `paymentHandler.js` check `if (jid.includes('@'))` before appending `@s.whatsapp.net`.

**Known limitation**: If a customer messages before `contacts.upsert` fires (first contact ever), the LID gets stored in the order. Sending messages to that order later still works because Baileys accepts LID JIDs for outgoing messages. The admin panel displays only the numeric part (strips everything from `@` onwards).

---

## Order lifecycle

```
awaiting_payment  → (webhook from MP) → confirmed
confirmed / cash / card orders  → start at confirmed
confirmed → preparing → out_for_delivery → delivered → (rating collected) → session reset
any state → cancelled
```

Status changes happen in `admin.js` (admin panel actions) and `webhook.js` (automatic PIX confirmation). Each status change calls `notifier.notifyOrderStatus()` which sends a WhatsApp message to the customer AND emits `order_status_update` via Socket.io.

---

## Payment flows

### PIX
1. `paymentHandler.js` calls `mercadopago.js` → creates MP payment → gets QR code string + `mp_payment_id`
2. Order saved with `status = 'awaiting_payment'`, `mp_payment_id` stored
3. 10-minute timeout: if webhook hasn't confirmed by then, order is cancelled
4. `webhook.js` receives MP notification, verifies HMAC signature, updates order to `confirmed`, calls `notifyAdmin` + `notifyOrderStatus`

**Error handling**: `let orderId` is declared *outside* the try block so the catch can cancel the order if it was already created before the error.

### Cash
Order saved immediately as `confirmed`. Admin is notified. `change_amount` stored if customer requested change for a larger bill.

### Card (maquininha)
Same as cash — `confirmed` immediately, no payment tracking.

---

## Stats endpoint

`GET /api/admin/stats` defaults to today (`date_from = date_to = today`). Accepts `date_from` and `date_to` query params (ISO date strings `YYYY-MM-DD`). Returns `{ total_orders, open_orders, revenue, avg_rating }`.

Orders endpoint `GET /api/admin/orders` also accepts `date_from`, `date_to`, `status`, `limit`.

---

## Known issues / non-bugs

- **`Failed to decrypt message`** in logs: harmless, Baileys trying to decrypt old messages with current session keys. Ignore.
- **Sessions folder grows**: `sessions/` contains Baileys auth state. Never commit. On explicit logout it's wiped automatically.
- **`sharp` compile warning on install**: non-fatal, sharp is a Baileys optional dependency for image processing.

---

## Environment variables

| Key | Required | Notes |
|-----|----------|-------|
| `PORT` | No | Default 3000 |
| `ADMIN_PASSWORD` | Yes | Plain text or bcrypt hash |
| `JWT_SECRET` | Yes | Random string, keep secret |
| `MP_ACCESS_TOKEN` | PIX only | Mercado Pago production token |
| `MP_WEBHOOK_SECRET` | PIX only | HMAC secret from MP dashboard |
| `WEBHOOK_BASE_URL` | PIX only | Public URL for MP to call back |

---

## Dependencies worth noting

| Package | Why |
|---------|-----|
| `@whiskeysockets/baileys` | WhatsApp Web reverse-engineered API |
| `better-sqlite3` | Sync SQLite — requires Python + VS Build Tools on Windows to compile |
| `qrcode` | Server-side PNG data URL generation for QR (CDN version doesn't expose global `QRCode`) |
| `qrcode-terminal` | Terminal ASCII QR display |
| `pino` | Baileys logger — set to `silent` to suppress noise |
| `bcryptjs` | Pure-JS bcrypt, no native compile needed |
