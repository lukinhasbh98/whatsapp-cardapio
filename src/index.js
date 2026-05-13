require('dotenv').config();
const { startBot, hasSession } = require('./bot/connection');
const { createServer } = require('./api/server');
const notifier = require('./services/notifier');

async function main() {
  console.log('🚀 Iniciando sistema de cardápio WhatsApp...');
  const sessionExists = hasSession();
  if (!sessionExists) {
    notifier.emitBotStatus('needs_connect');
    console.log('ℹ️  Nenhuma sessão WhatsApp encontrada. Clique em "Conectar" no painel admin para gerar o QR Code.');
  }
  const sock = sessionExists ? await startBot() : null;
  createServer(sock);
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
