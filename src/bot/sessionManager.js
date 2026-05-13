// Manages per-user conversation state in memory
const sessions = new Map();

const STATES = {
  IDLE: 'IDLE',
  AWAITING_NAME: 'AWAITING_NAME',
  MAIN_MENU: 'MAIN_MENU',
  BROWSING_CATEGORY: 'BROWSING_CATEGORY',
  BROWSING_ITEMS: 'BROWSING_ITEMS',
  ADDING_EXTRAS: 'ADDING_EXTRAS',
  AWAITING_QTY: 'AWAITING_QTY',
  CART_REVIEW: 'CART_REVIEW',
  AWAITING_ADDRESS: 'AWAITING_ADDRESS',
  CONFIRM_ADDRESS: 'CONFIRM_ADDRESS',
  PAYMENT_METHOD: 'PAYMENT_METHOD',
  AWAITING_CHANGE: 'AWAITING_CHANGE',
  AWAITING_PIX: 'AWAITING_PIX',
  ORDER_PLACED: 'ORDER_PLACED',
  AWAITING_RATING: 'AWAITING_RATING',
};

function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, {
      state: STATES.IDLE,
      cart: [],
      currentItem: null,
      address: '',
      customerName: '',
      paymentMethod: null,
      orderId: null,
      pendingPaymentId: null,
      lastActivity: Date.now(),
    });
  }
  const s = sessions.get(phone);
  s.lastActivity = Date.now();
  return s;
}

function resetSession(phone) {
  sessions.set(phone, {
    state: STATES.IDLE,
    cart: [],
    currentItem: null,
    address: '',
    customerName: '',
    paymentMethod: null,
    orderId: null,
    pendingPaymentId: null,
    lastActivity: Date.now(),
  });
}

function cartTotal(cart) {
  return cart.reduce((sum, item) => {
    const extrasTotal = item.extras.reduce((s, e) => s + e.price, 0);
    return sum + (item.price + extrasTotal) * item.qty;
  }, 0);
}

// Clean up sessions idle for more than 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [phone, s] of sessions.entries()) {
    if (s.lastActivity < cutoff) sessions.delete(phone);
  }
}, 30 * 60 * 1000);

module.exports = { getSession, resetSession, cartTotal, STATES };
