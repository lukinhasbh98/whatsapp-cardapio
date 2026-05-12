require('dotenv').config();
const { startBot } = require('./bot/connection');
const { createServer } = require('./api/server');

async function main() {
  console.log('🚀 Iniciando sistema de cardápio WhatsApp...');
  const sock = await startBot();
  createServer(sock);
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
