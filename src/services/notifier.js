const db = require('../database/db');
const QRCode = require('qrcode');

let _sock = null;
let _io = null;
let _lastQR = null;
let _botStatus = 'disconnected';

function init(sock, io) {
  _sock = sock;
  _io = io;
  io.on('connection', socket => {
    socket.emit('bot_status', { status: _botStatus });
    if (_botStatus === 'qr' && _lastQR) socket.emit('qr_code', { qr: _lastQR });
  });
}

async function emitQR(qr) {
  _lastQR = qr;
  try {
    const dataUrl = await QRCode.toDataURL(qr, { width: 256, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
    _lastQR = dataUrl;
    if (_io) _io.emit('qr_code', { qr: dataUrl });
  } catch (err) {
    console.error('Erro ao gerar QR:', err.message);
  }
}

function emitBotStatus(status) {
  _botStatus = status;
  if (status !== 'qr') _lastQR = null;
  if (_io) _io.emit('bot_status', { status });
}

async function notifyAdmin(sock, orderId) {
  const activeSock = sock || _sock;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return;

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  const orderNum = String(orderId).padStart(4, '0');

  // Emit to admin panel via socket.io
  if (_io) {
    _io.emit('new_order', { order, items });
  }

  // Send WhatsApp notification to admin number
  const adminPhone = db.getSetting('admin_whatsapp');
  if (!adminPhone || !activeSock) return;

  const adminJid = `${adminPhone.replace(/\D/g, '')}@s.whatsapp.net`;

  const paymentLabels = { pix: 'PIX', cash: 'Dinheiro', card: 'Cartão' };
  const payLabel = paymentLabels[order.payment_method] || order.payment_method;

  let msg = `🔔 *NOVO PEDIDO #${orderNum}*\n\n`;
  msg += `📱 Cliente: ${order.customer_phone}\n`;
  msg += `📍 Endereço: ${order.address}\n`;
  msg += `💳 Pagamento: ${payLabel}\n`;
  if (order.change_amount > 0) msg += `💵 Troco: R$ ${order.change_amount.toFixed(2)}\n`;
  msg += `\n🛒 *Itens:*\n`;
  items.forEach(i => {
    msg += `• ${i.item_name} x${i.qty}\n`;
    const extras = JSON.parse(i.extras_json || '[]');
    extras.forEach(e => { msg += `  + ${e.name}\n`; });
  });
  msg += `\n💰 *Total: R$ ${order.total.toFixed(2)}*`;

  try {
    await activeSock.sendMessage(adminJid, { text: msg });
  } catch (err) {
    console.error('Erro ao notificar admin:', err.message);
  }
}

async function notifyOrderStatus(sock, orderId, status) {
  const activeSock = sock || _sock;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) { console.warn('[notifier] pedido não encontrado:', orderId); return; }
  if (!activeSock) { console.warn('[notifier] sock indisponível para notificar pedido', orderId); return; }

  const orderNum = String(orderId).padStart(4, '0');
  const estTime = db.getSetting('estimated_time') || '40-60 minutos';
  const statusMessages = {
    confirmed:        `✅ Seu pedido *#${orderNum}* foi confirmado!\n\n⏱️ Tempo estimado: *${estTime}*\n\nVocê receberá atualizações por aqui. 😊`,
    preparing:        `👨‍🍳 Seu pedido *#${orderNum}* está sendo preparado! Já já fica pronto. 🔥`,
    out_for_delivery: `🛵 Seu pedido *#${orderNum}* saiu para entrega! Fique atento à porta. 😊`,
    delivered:        `✅ Seu pedido *#${orderNum}* foi entregue! Bom apetite! 🍽️\n\nQue nota você daria para nosso serviço? _(responda com um número de 1 a 5 ⭐)_`,
    cancelled:        `❌ Seu pedido *#${orderNum}* foi cancelado. Entre em contato se precisar de ajuda.`,
  };

  const msgText = statusMessages[status];
  if (!msgText) return;

  const customerJid = order.customer_phone.includes('@')
    ? order.customer_phone
    : `${order.customer_phone.replace(/\D/g, '')}@s.whatsapp.net`;

  try {
    await activeSock.sendMessage(customerJid, { text: msgText });

    if (status === 'delivered') {
      const { getSession, STATES } = require('../bot/sessionManager');
      const session = getSession(customerJid);
      session.state = STATES.AWAITING_RATING;
      session.orderId = orderId;
    }
  } catch (err) {
    console.error('Erro ao notificar cliente:', err.message);
  }

  if (_io) {
    _io.emit('order_status_update', { orderId: +orderId, status });
  }
}

function emitOrderUpdate(orderId, status) {
  if (_io) _io.emit('order_status_update', { orderId: +orderId, status });
}

function updateSock(sock) {
  _sock = sock;
}

function getBotStatus() {
  return { status: _botStatus, qr: _lastQR };
}

module.exports = { init, updateSock, notifyAdmin, notifyOrderStatus, emitQR, emitBotStatus, emitOrderUpdate, getBotStatus };
