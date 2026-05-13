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

function buildMainMenu(businessName, customer) {
  let msg = `*${businessName}* 🍴\n\nO que você deseja?\n\n`;
  msg += `1️⃣ Ver Cardápio\n`;
  if (customer && customer.last_order_id) msg += `2️⃣ Repetir último pedido\n`;
  msg += `3️⃣ Informações\n\n`;
  msg += `_Digite o número da opção desejada_`;
  return msg;
}

async function handleWelcome(sock, phone, session) {
  const businessName = db.getSetting('business_name') || 'Restaurante';
  const welcome = db.getSetting('welcome_message') || 'Olá!';

  if (!isOpen()) {
    const openTime = db.getSetting('business_hours_open') || '11:00';
    const closeTime = db.getSetting('business_hours_close') || '22:00';
    let closedMsg = db.getSetting('closed_message') || 'Estamos fechados. Voltamos às {open}.';
    closedMsg = closedMsg.replace('{open}', openTime).replace('{close}', closeTime);
    await sock.sendMessage(phone, { text: `⛔ *${businessName}*\n\n${closedMsg}` });
    return;
  }

  const customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
  session.returningCustomer = customer || null;

  // Ask for name if we don't have it yet
  if (!customer || !customer.name) {
    session.state = STATES.AWAITING_NAME;
    await sock.sendMessage(phone, {
      text: `${welcome}\n\n*${businessName}* 🍴\n\nPara começar, qual é o seu nome? 😊`,
    });
    return;
  }

  // Returning customer — greet by name
  session.customerName = customer.name;
  session.state = STATES.MAIN_MENU;

  const greeting = `Olá, *${customer.name}*! 😊\n\n`;
  await sock.sendMessage(phone, { text: greeting + buildMainMenu(businessName, customer) });
}

module.exports = { handleWelcome, isOpen, buildMainMenu };
