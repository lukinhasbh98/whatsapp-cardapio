const db = require('../../database/db');
const { STATES } = require('../sessionManager');

function isOpen() {
  const openStr = db.getSetting('business_hours_open') || '11:00';
  const closeStr = db.getSetting('business_hours_close') || '22:00';
  const now = new Date();
  const [oh, om] = openStr.split(':').map(Number);
  const [ch, cm] = closeStr.split(':').map(Number);
  const openMin = oh * 60 + om;
  const closeMin = ch * 60 + cm;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= openMin && nowMin < closeMin;
}

async function handleWelcome(sock, phone, session) {
  const name = db.getSetting('business_name') || 'Restaurante';
  const welcome = db.getSetting('welcome_message') || 'Olá!';

  if (!isOpen()) {
    const openTime = db.getSetting('business_hours_open') || '11:00';
    const closeTime = db.getSetting('business_hours_close') || '22:00';
    let closedMsg = db.getSetting('closed_message') || 'Estamos fechados. Voltamos às {open}.';
    closedMsg = closedMsg.replace('{open}', openTime).replace('{close}', closeTime);
    await sock.sendMessage(phone, { text: `⛔ *${name}*\n\n${closedMsg}` });
    return;
  }

  // Check for returning customer
  const customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);

  let msg = `${welcome}\n\n*${name}* 🍴\n\n`;
  msg += `O que você deseja?\n\n`;
  msg += `1️⃣ Ver Cardápio\n`;
  if (customer && customer.last_order_id) msg += `2️⃣ Repetir último pedido\n`;
  msg += `3️⃣ Informações\n\n`;
  msg += `_Digite o número da opção desejada_`;

  session.state = STATES.MAIN_MENU;
  session.returningCustomer = customer;

  await sock.sendMessage(phone, { text: msg });
}

module.exports = { handleWelcome, isOpen };
