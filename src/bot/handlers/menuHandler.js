const db = require('../../database/db');
const { STATES, cartTotal } = require('../sessionManager');

function fmt(price) {
  return `R$ ${Number(price).toFixed(2).replace('.', ',')}`;
}

async function sendCategories(sock, phone, session) {
  const categories = db.prepare(
    'SELECT * FROM categories WHERE active = 1 ORDER BY sort_order'
  ).all();

  if (!categories.length) {
    await sock.sendMessage(phone, { text: '⚠️ O cardápio está vazio no momento. Tente novamente mais tarde.' });
    return;
  }

  let msg = '🍴 *CARDÁPIO*\n\nEscolha uma categoria:\n\n';
  categories.forEach((c, i) => {
    msg += `${i + 1}️⃣ ${c.emoji} ${c.name}\n`;
  });
  msg += `\n0️⃣ 🛒 Ver carrinho`;
  msg += `\n\n_Digite o número da categoria_`;

  session.state = STATES.BROWSING_CATEGORY;
  session.categories = categories;

  await sock.sendMessage(phone, { text: msg });
}

async function sendItems(sock, phone, session, categoryIndex) {
  const category = session.categories[categoryIndex];
  if (!category) {
    await sock.sendMessage(phone, { text: '❌ Opção inválida. Tente novamente.' });
    return;
  }

  const todayIdx = new Date().getDay(); // 0=Dom, 1=Seg ... 6=Sáb
  const allItems = db.prepare('SELECT * FROM menu_items WHERE category_id = ? AND active = 1').all(category.id);
  const items = allItems.filter(item => {
    const days = JSON.parse(item.available_days || '[]');
    return days.length === 0 || days.includes(todayIdx);
  });

  if (!items.length) {
    const DAY_NAMES = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
    await sock.sendMessage(phone, { text: `⚠️ Nenhum item disponível em *${category.name}* nesta ${DAY_NAMES[todayIdx]}. Tente outra categoria!` });
    await sendCategories(sock, phone, session);
    return;
  }

  let msg = `${category.emoji} *${category.name.toUpperCase()}*\n\n`;
  items.forEach((item, i) => {
    msg += `*${i + 1}. ${item.name}*`;
    if (item.description) msg += `\n   _${item.description}_`;
    msg += `\n   ${fmt(item.price)}\n\n`;
  });
  msg += `0️⃣ ↩️ Voltar às categorias\n\n_Digite o número do item_`;

  session.state = STATES.BROWSING_ITEMS;
  session.currentCategory = category;
  session.currentItems = items;

  await sock.sendMessage(phone, { text: msg });
}

async function sendExtras(sock, phone, session, item) {
  const extras = db.prepare('SELECT * FROM item_extras WHERE item_id = ?').all(item.id);

  if (!extras.length) {
    session.currentItem = { ...item, extras: [], qty: 1 };
    session.state = STATES.AWAITING_QTY;
    await sock.sendMessage(phone, {
      text: `✅ *${item.name}* selecionado!\n\nQuantas unidades você quer?\n\n_Digite apenas o número (ex: 1, 2, 3...)_`,
    });
    return;
  }

  let msg = `🔧 *Acréscimos para ${item.name}*\n\n`;
  extras.forEach((e, i) => {
    msg += `${i + 1}️⃣ ${e.name} (+${fmt(e.price)})\n`;
  });
  msg += `\n0️⃣ Nenhum acréscimo\n\n_Digite os números separados por vírgula (ex: 1,3) ou 0 para nenhum_`;

  session.state = STATES.ADDING_EXTRAS;
  session.currentItem = { ...item, extras: [], qty: 1 };
  session.availableExtras = extras;

  await sock.sendMessage(phone, { text: msg });
}

async function sendCart(sock, phone, session) {
  if (!session.cart.length) {
    await sock.sendMessage(phone, { text: '🛒 Seu carrinho está vazio!' });
    await sendCategories(sock, phone, session);
    return;
  }

  const deliveryFee = parseFloat(db.getSetting('delivery_fee') || '5');
  const minOrder = parseFloat(db.getSetting('min_order') || '20');
  const subtotal = cartTotal(session.cart);
  const total = subtotal + deliveryFee;

  let msg = `🛒 *SEU CARRINHO*\n\n`;
  session.cart.forEach((item, i) => {
    const extrasTotal = item.extras.reduce((s, e) => s + e.price, 0);
    msg += `*${i + 1}. ${item.name}* x${item.qty}\n`;
    item.extras.forEach(e => { msg += `   + ${e.name} (${fmt(e.price)})\n`; });
    msg += `   ${fmt((item.price + extrasTotal) * item.qty)}\n\n`;
  });
  msg += `─────────────────\n`;
  msg += `Subtotal: ${fmt(subtotal)}\n`;
  msg += `Taxa de entrega: ${fmt(deliveryFee)}\n`;
  msg += `*Total: ${fmt(total)}*\n\n`;

  if (subtotal < minOrder) {
    msg += `⚠️ Pedido mínimo: ${fmt(minOrder)}. Adicione mais itens.\n\n`;
    msg += `1️⃣ ➕ Adicionar mais itens\n2️⃣ ❌ Cancelar pedido`;
    session.state = STATES.CART_REVIEW;
    session.cartBelowMin = true;
  } else {
    msg += `1️⃣ ✅ Confirmar e informar endereço\n2️⃣ ➕ Adicionar mais itens\n3️⃣ ❌ Cancelar pedido`;
    session.state = STATES.CART_REVIEW;
    session.cartBelowMin = false;
  }

  await sock.sendMessage(phone, { text: msg });
}

module.exports = { sendCategories, sendItems, sendExtras, sendCart, fmt };
