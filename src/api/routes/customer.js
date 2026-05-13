const express = require('express');
const db = require('../../database/db');
const { customerAuthMiddleware } = require('./auth');
const { notifyAdmin } = require('../../services/notifier');
const { createPixPayment } = require('../../services/mercadopago');
const router = express.Router();

// ── Public: business settings ────────────────────────────────────────────────
router.get('/settings', (req, res) => {
  const keys = ['business_name', 'welcome_message', 'business_hours_open', 'business_hours_close',
    'delivery_fee', 'min_order', 'estimated_time', 'pix_key'];
  const result = {};
  keys.forEach(k => { result[k] = db.getSetting(k) || ''; });
  res.json(result);
});

// ── Public: categories ───────────────────────────────────────────────────────
router.get('/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM categories WHERE active = 1 ORDER BY sort_order').all());
});

// ── Public: items by category (day-filtered) ─────────────────────────────────
router.get('/items', (req, res) => {
  const { category_id } = req.query;
  if (!category_id) return res.status(400).json({ error: 'category_id obrigatório' });
  const todayIdx = new Date().getDay();
  const all = db.prepare('SELECT * FROM menu_items WHERE category_id = ? AND active = 1').all(category_id);
  const items = all.filter(item => {
    const days = JSON.parse(item.available_days || '[]');
    return days.length === 0 || days.includes(todayIdx);
  });
  res.json(items);
});

// ── Public: item extras ──────────────────────────────────────────────────────
router.get('/items/:id/extras', (req, res) => {
  res.json(db.prepare('SELECT * FROM item_extras WHERE item_id = ?').all(req.params.id));
});

// ── Authenticated: profile ───────────────────────────────────────────────────
router.get('/profile', customerAuthMiddleware, (req, res) => {
  const c = db.prepare('SELECT id, name, email, phone, last_address FROM customers WHERE id = ?').get(req.customer.id);
  if (!c) return res.status(404).json({ error: 'Cliente não encontrado' });
  res.json(c);
});

router.put('/profile', customerAuthMiddleware, (req, res) => {
  const { name, address } = req.body;
  if (name) db.prepare('UPDATE customers SET name = ? WHERE id = ?').run(name.trim(), req.customer.id);
  if (address) db.prepare('UPDATE customers SET last_address = ? WHERE id = ?').run(address.trim(), req.customer.id);
  res.json({ ok: true });
});

// ── Authenticated: place order ───────────────────────────────────────────────
router.post('/orders', customerAuthMiddleware, async (req, res) => {
  const { items, address, payment_method, change_amount } = req.body;

  if (!items || !items.length) return res.status(400).json({ error: 'Carrinho vazio.' });
  if (!address || address.trim().length < 10) return res.status(400).json({ error: 'Endereço muito curto.' });
  if (!['pix', 'cash', 'card'].includes(payment_method))
    return res.status(400).json({ error: 'Método de pagamento inválido.' });

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.customer.id);
  if (!customer) return res.status(404).json({ error: 'Cliente não encontrado.' });

  const deliveryFee = parseFloat(db.getSetting('delivery_fee') || '5');
  const minOrder    = parseFloat(db.getSetting('min_order') || '20');

  let subtotal = 0;
  for (const item of items) {
    const extrasTotal = (item.extras || []).reduce((s, e) => s + (parseFloat(e.price) || 0), 0);
    subtotal += (parseFloat(item.price) + extrasTotal) * parseInt(item.qty);
  }

  if (subtotal < minOrder)
    return res.status(400).json({ error: `Pedido mínimo é R$ ${minOrder.toFixed(2).replace('.', ',')}.` });

  const total      = subtotal + deliveryFee;
  const status     = payment_method === 'pix' ? 'awaiting_payment' : 'confirmed';
  const changeAmt  = payment_method === 'cash' ? (parseFloat(change_amount) || 0) : 0;
  const cleanAddr  = address.trim();

  const orderResult = db.prepare(`
    INSERT INTO orders (customer_phone, customer_name, address, status, payment_method, subtotal, delivery_fee, total, change_amount)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(customer.phone, customer.name, cleanAddr, status, payment_method, subtotal, deliveryFee, total, changeAmt);

  const orderId = orderResult.lastInsertRowid;

  const itemStmt = db.prepare(
    'INSERT INTO order_items (order_id, item_id, item_name, qty, unit_price, extras_json) VALUES (?,?,?,?,?,?)'
  );
  for (const item of items) {
    itemStmt.run(orderId, item.id || null, item.name, item.qty, parseFloat(item.price), JSON.stringify(item.extras || []));
  }

  db.prepare('UPDATE customers SET last_address = ?, last_order_id = ? WHERE id = ?')
    .run(cleanAddr, orderId, req.customer.id);

  // Gera pagamento PIX real no Mercado Pago
  let pixQrCode = null, pixQrCodeBase64 = null;
  if (payment_method === 'pix') {
    try {
      const pixData = await createPixPayment(total, orderId, customer.phone);
      db.prepare('UPDATE orders SET mp_payment_id = ? WHERE id = ?').run(String(pixData.id), orderId);
      pixQrCode       = pixData.qrCode;
      pixQrCodeBase64 = pixData.qrCodeBase64;
    } catch (err) {
      console.error('[PIX] Erro ao criar pagamento MP:', err.message);
    }
  }

  await notifyAdmin(null, orderId).catch(console.error);

  res.json({ orderId, orderNum: String(orderId).padStart(4, '0'), status, total, deliveryFee, pixQrCode, pixQrCodeBase64 });
});

// ── Authenticated: order history ─────────────────────────────────────────────
router.get('/orders', customerAuthMiddleware, (req, res) => {
  const c = db.prepare('SELECT phone FROM customers WHERE id = ?').get(req.customer.id);
  if (!c) return res.status(404).json({ error: 'Cliente não encontrado' });
  const orders = db.prepare(
    'SELECT id, status, total, payment_method, created_at, address FROM orders WHERE customer_phone = ? ORDER BY created_at DESC LIMIT 20'
  ).all(c.phone);
  res.json(orders);
});

// ── Authenticated: single order with items ───────────────────────────────────
router.get('/orders/:id', customerAuthMiddleware, (req, res) => {
  const c = db.prepare('SELECT phone FROM customers WHERE id = ?').get(req.customer.id);
  if (!c) return res.status(404).json({ error: 'Cliente não encontrado' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND customer_phone = ?').get(req.params.id, c.phone);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id);
  res.json({ ...order, items });
});

module.exports = router;
