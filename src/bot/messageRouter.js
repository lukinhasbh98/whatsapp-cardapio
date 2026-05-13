const db = require('../database/db');
const { resolveJid } = require('./contactStore');
const { getSession, resetSession, cartTotal, STATES } = require('./sessionManager');
const { handleWelcome, isOpen, buildMainMenu } = require('./handlers/welcomeHandler');
const { sendCategories, sendItems, sendExtras, sendCart } = require('./handlers/menuHandler');
const { askAddress, handleAddressInput } = require('./handlers/addressHandler');
const { handlePaymentChoice, handleChangeAmount } = require('./handlers/paymentHandler');

function extractText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.buttonsResponseMessage?.selectedButtonId ||
    msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ''
  ).trim();
}

async function handleMessage(sock, msg) {
  const rawJid = msg.key.remoteJid;
  if (!rawJid || rawJid.endsWith('@g.us')) return; // ignore group messages
  const phone = resolveJid(rawJid); // @lid → @s.whatsapp.net when mapping is known

  const text = extractText(msg);
  if (!text) return;

  const session = getSession(phone);

  // Global cancel command
  if (['cancelar', 'cancel', 'sair', 'exit', '0'].includes(text.toLowerCase()) &&
      session.state !== STATES.IDLE && session.state !== STATES.AWAITING_PIX) {
    resetSession(phone);
    await sock.sendMessage(phone, { text: '✅ Atendimento encerrado. Para um novo pedido, é só mandar mensagem! 😊' });
    return;
  }

  // Rating response
  if (session.state === STATES.AWAITING_RATING) {
    await handleRating(sock, phone, session, text);
    return;
  }

  // Name capture
  if (session.state === STATES.AWAITING_NAME) {
    await handleNameInput(sock, phone, session, text);
    return;
  }

  // Idle / new conversation
  if (session.state === STATES.IDLE || session.state === STATES.ORDER_PLACED) {
    await handleWelcome(sock, phone, session);
    return;
  }

  // Main menu
  if (session.state === STATES.MAIN_MENU) {
    if (text === '1') {
      await sendCategories(sock, phone, session);
    } else if (text === '2' && session.returningCustomer?.last_order_id) {
      await repeatLastOrder(sock, phone, session);
    } else if (text === '3') {
      await sendInfo(sock, phone);
    } else {
      await handleWelcome(sock, phone, session);
    }
    return;
  }

  // Category browsing
  if (session.state === STATES.BROWSING_CATEGORY) {
    if (text === '0') {
      await sendCart(sock, phone, session);
    } else {
      const idx = parseInt(text) - 1;
      await sendItems(sock, phone, session, idx);
    }
    return;
  }

  // Item browsing
  if (session.state === STATES.BROWSING_ITEMS) {
    if (text === '0') {
      await sendCategories(sock, phone, session);
    } else {
      const idx = parseInt(text) - 1;
      const item = session.currentItems?.[idx];
      if (!item) {
        await sock.sendMessage(phone, { text: '❌ Opção inválida.' });
      } else {
        await sendExtras(sock, phone, session, item);
      }
    }
    return;
  }

  // Extras selection
  if (session.state === STATES.ADDING_EXTRAS) {
    const selectedExtras = [];
    if (text !== '0') {
      const indices = text.split(',').map(s => parseInt(s.trim()) - 1);
      for (const i of indices) {
        if (session.availableExtras[i]) selectedExtras.push(session.availableExtras[i]);
      }
    }
    session.currentItem.extras = selectedExtras;
    session.state = STATES.AWAITING_QTY;
    const extrasMsg = selectedExtras.length ? `\nAcréscimos: ${selectedExtras.map(e => e.name).join(', ')}` : '';
    await sock.sendMessage(phone, {
      text: `✅ *${session.currentItem.name}*${extrasMsg}\n\nQuantas unidades?\n_Digite apenas o número_`,
    });
    return;
  }

  // Quantity
  if (session.state === STATES.AWAITING_QTY) {
    const qty = parseInt(text);
    if (isNaN(qty) || qty < 1) {
      await sock.sendMessage(phone, { text: '❌ Quantidade inválida. Digite um número maior que 0.' });
      return;
    }
    session.currentItem.qty = qty;
    session.cart.push({ ...session.currentItem });

    const { fmt } = require('./handlers/menuHandler');
    const deliveryFee = parseFloat(db.getSetting('delivery_fee') || '5');
    const subtotal = cartTotal(session.cart);

    await sock.sendMessage(phone, {
      text: `✅ *${session.currentItem.name}* x${qty} adicionado ao carrinho!\n\n🛒 Subtotal: ${fmt(subtotal)}\n\nO que deseja?\n\n1️⃣ ➕ Adicionar mais itens\n2️⃣ ✅ Finalizar pedido`,
    });
    session.state = STATES.CART_REVIEW;
    session.cartQuickChoice = true;
    return;
  }

  // Cart review
  if (session.state === STATES.CART_REVIEW) {
    if (session.cartQuickChoice) {
      session.cartQuickChoice = false;
      if (text === '1') {
        await sendCategories(sock, phone, session);
      } else if (text === '2') {
        await sendCart(sock, phone, session);
      } else {
        await sendCart(sock, phone, session);
      }
      return;
    }

    if (session.cartBelowMin) {
      if (text === '1') await sendCategories(sock, phone, session);
      else if (text === '2') { resetSession(phone); await sock.sendMessage(phone, { text: '✅ Pedido cancelado.' }); }
      else await sendCart(sock, phone, session);
    } else {
      if (text === '1') await askAddress(sock, phone, session);
      else if (text === '2') await sendCategories(sock, phone, session);
      else if (text === '3') { resetSession(phone); await sock.sendMessage(phone, { text: '✅ Pedido cancelado.' }); }
      else await sendCart(sock, phone, session);
    }
    return;
  }

  // Address
  if (session.state === STATES.AWAITING_ADDRESS || session.state === STATES.CONFIRM_ADDRESS) {
    await handleAddressInput(sock, phone, session, text);
    return;
  }

  // Payment method
  if (session.state === STATES.PAYMENT_METHOD) {
    await handlePaymentChoice(sock, phone, session, text);
    return;
  }

  // Change amount
  if (session.state === STATES.AWAITING_CHANGE) {
    await handleChangeAmount(sock, phone, session, text);
    return;
  }

  // Awaiting PIX
  if (session.state === STATES.AWAITING_PIX) {
    await sock.sendMessage(phone, {
      text: `⏳ Aguardando confirmação do pagamento PIX...\n\nSe quiser cancelar, digite *cancelar*.`,
    });
    return;
  }

  // Default fallback
  await handleWelcome(sock, phone, session);
}

async function handleNameInput(sock, phone, session, text) {
  const trimmed = text.trim();
  if (trimmed.length < 2) {
    await sock.sendMessage(phone, { text: '❌ Nome muito curto. Por favor, informe seu nome.' });
    return;
  }

  session.customerName = trimmed;

  const existing = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
  if (existing) {
    db.prepare('UPDATE customers SET name = ? WHERE phone = ?').run(trimmed, phone);
    session.returningCustomer = { ...existing, name: trimmed };
  } else {
    db.prepare('INSERT INTO customers (phone, name) VALUES (?, ?)').run(phone, trimmed);
    session.returningCustomer = { phone, name: trimmed, last_address: '', last_order_id: null };
  }

  const businessName = db.getSetting('business_name') || 'Restaurante';
  session.state = STATES.MAIN_MENU;
  await sock.sendMessage(phone, {
    text: `✅ Prazer, *${trimmed}*! 😊\n\n` + buildMainMenu(businessName, session.returningCustomer),
  });
}

async function repeatLastOrder(sock, phone, session) {
  const customer = session.returningCustomer;
  const lastOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(customer.last_order_id);
  if (!lastOrder) { await sendCategories(sock, phone, session); return; }

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(lastOrder.id);
  session.cart = items.map(i => ({
    id: i.item_id,
    name: i.item_name,
    price: i.unit_price,
    qty: i.qty,
    extras: JSON.parse(i.extras_json || '[]'),
  }));

  const { fmt } = require('./handlers/menuHandler');
  const deliveryFee = parseFloat(db.getSetting('delivery_fee') || '5');
  const subtotal = cartTotal(session.cart);
  const total = subtotal + deliveryFee;

  let msg = `🔄 *Repetindo último pedido:*\n\n`;
  session.cart.forEach(i => { msg += `• ${i.name} x${i.qty} — ${fmt(i.price * i.qty)}\n`; });
  msg += `\nTotal: *${fmt(total)}*\n\n1️⃣ ✅ Confirmar\n2️⃣ 🍴 Montar novo pedido`;
  session.state = STATES.CART_REVIEW;
  session.cartBelowMin = false;
  session.cartQuickChoice = false;
  await sock.sendMessage(phone, { text: msg });
}

async function handleRating(sock, phone, session, text) {
  const score = parseInt(text);
  if (isNaN(score) || score < 1 || score > 5) {
    await sock.sendMessage(phone, { text: '⭐ Por favor, envie uma nota de 1 a 5.' });
    return;
  }
  db.prepare('INSERT INTO ratings (order_id, customer_phone, score) VALUES (?, ?, ?)')
    .run(session.orderId, phone, score);
  resetSession(phone);
  await sock.sendMessage(phone, {
    text: `⭐ Obrigado pela avaliação! Sua opinião é muito importante para nós. 😊\n\nAté a próxima! 👋`,
  });
}

async function sendInfo(sock, phone) {
  const name = db.getSetting('business_name') || 'Restaurante';
  const open = db.getSetting('business_hours_open') || '11:00';
  const close = db.getSetting('business_hours_close') || '22:00';
  const delivery = db.getSetting('delivery_fee') || '5,00';
  const min = db.getSetting('min_order') || '20,00';
  const time = db.getSetting('estimated_time') || '40-60 minutos';

  const { fmt } = require('./handlers/menuHandler');
  await sock.sendMessage(phone, {
    text: `ℹ️ *${name}*\n\n🕐 Horário: ${open} às ${close}\n🛵 Taxa de entrega: ${fmt(delivery)}\n🛒 Pedido mínimo: ${fmt(min)}\n⏱️ Tempo estimado: ${time}\n\n_Digite qualquer mensagem para voltar ao menu._`,
  });
}

module.exports = { handleMessage };
