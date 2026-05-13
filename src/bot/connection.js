require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, fetchLatestWAWebVersion, Browsers } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const notifier = require('../services/notifier');
const { upsertContacts } = require('./contactStore');
const { handleMessage } = require('./messageRouter');

const SESSIONS_PATH = path.join(__dirname, '../../sessions');

let _reconnectDelay = 5000;
let _connecting = false;

function hasSession() {
  try {
    return fs.readdirSync(SESSIONS_PATH).some(f => f.endsWith('.json'));
  } catch { return false; }
}

async function startBot() {
  if (_connecting) return;
  _connecting = true;

  const { state, saveCreds } = await useMultiFileAuthState(SESSIONS_PATH);
  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {
    version = [2, 3000, 1015901307];
  }
  console.log('📡 Versão Baileys:', version?.join('.'));

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    markOnlineOnConnect: false,
    retryRequestDelayMs: 3000,
    defaultQueryTimeoutMs: undefined,
  });

  _connecting = false;

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('contacts.upsert', upsertContacts);
  sock.ev.on('contacts.update', upsertContacts);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 QR Code gerado — escaneie com seu WhatsApp:\n');
      qrcode.generate(qr, { small: true });
      await notifier.emitQR(qr);   // aguarda data URL antes de avisar o painel
      notifier.emitBotStatus('qr');
    }
    if (connection === 'open') {
      console.log('✅ Bot conectado ao WhatsApp!');
      _reconnectDelay = 5000;
      notifier.updateSock(sock);
      notifier.emitBotStatus('connected');
    }
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = reason === DisconnectReason.loggedOut;
      const hadSession = hasSession();
      // 403/405/500 só são fatais se havia sessão (logout remoto). Sem sessão = bloqueio temporário.
      const badSession = loggedOut || (hadSession && [403, 405, 500].includes(reason));
      console.log('⚠️ Conexão encerrada. Motivo:', reason, '| Erro:', lastDisconnect?.error?.message);

      if (badSession) {
        fs.rmSync(SESSIONS_PATH, { recursive: true, force: true });
        fs.mkdirSync(SESSIONS_PATH, { recursive: true });
        console.log('🗑️ Sessão removida. Clique em "Conectar" no painel para gerar novo QR Code.');
        _connecting = false;
        notifier.emitBotStatus('needs_connect');
      } else if (!hadSession) {
        // Sem sessão: não há QR para exibir sem nova tentativa manual — não auto-reiniciar.
        console.log('⚠️ Conexão falhou antes do QR Code (motivo:', reason, '). Clique em "Conectar" para tentar novamente.');
        _connecting = false;
        notifier.emitBotStatus('needs_connect');
      } else {
        // Tem sessão, queda temporária → reconecta automaticamente
        console.log('Reconectando em', _reconnectDelay / 1000, 's...');
        notifier.emitBotStatus('disconnected');
        setTimeout(startBot, _reconnectDelay);
        _reconnectDelay = Math.min(_reconnectDelay * 2, 120000);
      }
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    Promise.all(
      messages
        .filter(msg => !msg.key.fromMe && msg.message)
        .map(msg => handleMessage(sock, msg).catch(err => console.error('Message handler error:', err)))
    );
  });

  return sock;
}

function isConnecting() { return _connecting; }

module.exports = { startBot, hasSession, isConnecting };
