require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const notifier = require('../services/notifier');
const { upsertContacts } = require('./contactStore');
const { handleMessage } = require('./messageRouter');

const SESSIONS_PATH = path.join(__dirname, '../../sessions');

let _reconnectDelay = 5000;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSIONS_PATH);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['Cardápio Bot', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('contacts.upsert', upsertContacts);
  sock.ev.on('contacts.update', upsertContacts);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 Escaneie o QR Code abaixo com seu WhatsApp:\n');
      qrcode.generate(qr, { small: true });
      notifier.emitQR(qr);
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
      const badSession = loggedOut || [403, 405, 500].includes(reason);
      console.log('⚠️ Conexão encerrada. Motivo:', reason, '| Reconectando em', _reconnectDelay / 1000, 's...');
      notifier.emitBotStatus('disconnected');
      if (badSession) {
        fs.rmSync(SESSIONS_PATH, { recursive: true, force: true });
        fs.mkdirSync(SESSIONS_PATH, { recursive: true });
        console.log('🗑️ Sessão removida. Aguardando novo QR Code...');
      }
      setTimeout(startBot, _reconnectDelay);
      _reconnectDelay = Math.min(_reconnectDelay * 2, 120000); // dobra até 2 minutos
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (!msg.message) continue;
      await handleMessage(sock, msg).catch(err => console.error('Message handler error:', err));
    }
  });

  return sock;
}

module.exports = { startBot };
