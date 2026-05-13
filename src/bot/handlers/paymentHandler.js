const db = require('../../database/db');
const { STATES, cartTotal, resetSession } = require('../sessionManager');
const { createPixPayment } = require('../../services/mercadopago');
const { notifyAdmin, emitOrderUpdate } = require('../../services/notifier');
const { fmt } = require('./menuHandler');

async function handlePaymentChoice(sock, phone, session, choice) {
  const deliveryFee = parseFloat(db.getSetting('delivery_fee') || '5');
  const subtotal = cartTotal(session.cart);
  const total = subtotal + deliveryFee;

  if (choice === '1') {
    await handlePix(sock, phone, session, total, deliveryFee, subtotal);
  } else if (choice === '2') {
    session.paymentMethod = 'cash';
    session.orderTotal = total;
    session.state = STATES.AWAITING_CHANGE;
    await sock.sendMessage(phone, {
      text: `💵 *Pagamento em Dinheiro*\n\nTotal do pedido: *${fmt(total)}*\n\nVai pagar com quanto?\n_Ex: 50, 100..._`,
    });
  } else if (choice === '3') {
    session.paymentMethod = 'card';
    await placeOrder(sock, phone, session, total, deliveryFee, subtotal);
  } else {
    await sock.sendMessage(phone, { text: '❌ Opção inválida. Digite 1, 2 ou 3.' });
  }
}

async function handlePix(sock, phone, session, total, deliveryFee, subtotal) {
  session.paymentMethod = 'pix';
  session.orderTotal = total;

  await sock.sendMessage(phone, { text: `⏳ Gerando QR Code PIX... aguarde um momento.` });

  let orderId;
  try {
    orderId = await saveOrder(phone, session, total, deliveryFee, subtotal, 'pix');
    session.orderId = orderId;

    const pixData = await createPixPayment(total, orderId, phone);
    session.pendingPaymentId = pixData.id;
    session.state = STATES.AWAITING_PIX;

    // Update order with MP payment id
    db.prepare('UPDATE orders SET mp_payment_id = ? WHERE id = ?').run(String(pixData.id), orderId);

    await sock.sendMessage(phone, {
      text: `💸 *Pagamento via PIX*\n\nTotal: *${fmt(total)}*\n\n📋 *Copia e Cola:*\n\`\`\`${pixData.qrCode}\`\`\`\n\n⏳ Aguardando confirmação do pagamento...\n_Você tem 10 minutos para pagar._`,
    });

    if (pixData.qrCodeBase64) {
      const imgBuffer = Buffer.from(pixData.qrCodeBase64, 'base64');
      await sock.sendMessage(phone, {
        image: imgBuffer,
        caption: '📲 Escaneie o QR Code para pagar',
      });
    }

    // Timeout after 10 minutes
    setTimeout(async () => {
      const s = require('../sessionManager').getSession(phone);
      if (s.state === STATES.AWAITING_PIX && s.pendingPaymentId === pixData.id) {
        db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(orderId);
        emitOrderUpdate(orderId, 'cancelled');
        resetSession(phone);
        await sock.sendMessage(phone, {
          text: `⚠️ Pagamento PIX não identificado. Seu pedido foi cancelado.\n\nDigite qualquer mensagem para começar um novo pedido.`,
        });
      }
    }, 10 * 60 * 1000);

  } catch (err) {
    console.error('PIX error:', err);
    if (orderId) {
      db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(orderId);
      emitOrderUpdate(orderId, 'cancelled');
    }
    await sock.sendMessage(phone, {
      text: `❌ Erro ao gerar PIX. Tente outro método de pagamento:\n\n1️⃣ 💸 PIX\n2️⃣ 💵 Dinheiro\n3️⃣ 💳 Cartão`,
    });
    session.state = STATES.PAYMENT_METHOD;
  }
}

async function handleChangeAmount(sock, phone, session, text) {
  const amount = parseFloat(text.replace(',', '.').replace(/[^0-9.]/g, ''));
  if (isNaN(amount) || amount <= 0) {
    await sock.sendMessage(phone, { text: '❌ Valor inválido. Digite apenas o valor (ex: 50).' });
    return;
  }

  const total = session.orderTotal;
  if (amount < total) {
    await sock.sendMessage(phone, {
      text: `❌ O valor informado (${fmt(amount)}) é menor que o total (${fmt(total)}). Digite um valor maior.`,
    });
    return;
  }

  const change = amount - total;
  session.changeAmount = change;
  await placeOrder(sock, phone, session, total,
    parseFloat(db.getSetting('delivery_fee') || '5'),
    cartTotal(session.cart), 'cash');
}

async function placeOrder(sock, phone, session, total, deliveryFee, subtotal, method) {
  const orderId = session.orderId || await saveOrder(phone, session, total, deliveryFee, subtotal, method || session.paymentMethod);
  session.orderId = orderId;

  const estTime = db.getSetting('estimated_time') || '40-60 minutos';
  const orderNum = String(orderId).padStart(4, '0');

  let msg = `✅ *PEDIDO CONFIRMADO!*\n\n`;
  msg += `🔢 Pedido: *#${orderNum}*\n`;
  msg += `📍 Endereço: ${session.address}\n`;
  msg += `💰 Total: *${fmt(total)}*\n`;

  if (session.paymentMethod === 'cash' && session.changeAmount > 0) {
    msg += `💵 Troco para: ${fmt(total + session.changeAmount)} → *Troco: ${fmt(session.changeAmount)}*\n`;
  }
  if (session.paymentMethod === 'card') {
    msg += `💳 Pagamento: Cartão (maquininha com entregador)\n`;
  }

  msg += `\n⏱️ Tempo estimado: *${estTime}*\n\n`;
  msg += `Acompanhe seu pedido aqui! Te avisaremos quando sair para entrega. 🛵`;

  await sock.sendMessage(phone, { text: msg });

  // Update customer record
  const customerName = session.customerName || session.returningCustomer?.name || '';
  const customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
  if (customer) {
    db.prepare('UPDATE customers SET name = COALESCE(NULLIF(?, \'\'), name), last_address = ?, last_order_id = ? WHERE phone = ?')
      .run(customerName, session.address, orderId, phone);
  } else {
    db.prepare('INSERT INTO customers (phone, name, last_address, last_order_id) VALUES (?, ?, ?, ?)')
      .run(phone, customerName, session.address, orderId);
  }

  session.state = STATES.ORDER_PLACED;
  notifyAdmin(sock, orderId);
}

async function confirmPixPayment(sock, phone, orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return;

  db.prepare("UPDATE orders SET status = 'confirmed' WHERE id = ?").run(orderId);

  const orderNum = String(orderId).padStart(4, '0');
  const estTime = db.getSetting('estimated_time') || '40-60 minutos';
  const customerJid = order.customer_phone.includes('@')
    ? order.customer_phone
    : `${order.customer_phone.replace(/\D/g, '')}@s.whatsapp.net`;

  await sock.sendMessage(customerJid, {
    text: `✅ *PAGAMENTO PIX CONFIRMADO!*\n\n🔢 Pedido: *#${orderNum}*\n⏱️ Tempo estimado: *${estTime}*\n\nSeu pedido já está sendo preparado! 🍽️`,
  });

  notifyAdmin(sock, orderId);

  const { getSession } = require('../sessionManager');
  const session = getSession(phone);
  session.state = STATES.ORDER_PLACED;
}

async function saveOrder(phone, session, total, deliveryFee, subtotal, paymentMethod) {
  const stmt = db.prepare(`
    INSERT INTO orders (customer_phone, customer_name, address, status, payment_method, subtotal, delivery_fee, total, change_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const customerName = session.customerName || session.returningCustomer?.name || '';
  const status = paymentMethod === 'pix' ? 'awaiting_payment' : 'confirmed';
  const changeAmount = session.changeAmount || 0;

  const result = stmt.run(phone, customerName, session.address, status, paymentMethod,
    subtotal, deliveryFee, total, changeAmount);
  const orderId = result.lastInsertRowid;

  const itemStmt = db.prepare(`
    INSERT INTO order_items (order_id, item_id, item_name, qty, unit_price, extras_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const item of session.cart) {
    itemStmt.run(orderId, item.id, item.name, item.qty, item.price, JSON.stringify(item.extras));
  }

  return orderId;
}

module.exports = { handlePaymentChoice, handleChangeAmount, confirmPixPayment, placeOrder };
