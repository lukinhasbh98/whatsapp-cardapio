const express = require('express');
const db = require('../../database/db');
const { deliveryAuthMiddleware } = require('./auth');
const { notifyOrderStatus } = require('../../services/notifier');
const router = express.Router();

// Orders currently out for delivery
router.get('/orders', deliveryAuthMiddleware, (req, res) => {
  const orders = db.prepare(`
    SELECT id, customer_name, customer_phone, address, total,
           payment_method, change_amount, status, created_at
    FROM orders
    WHERE status = 'out_for_delivery'
    ORDER BY created_at DESC
  `).all();
  res.json(orders);
});

// Mark a single order as delivered
router.put('/orders/:id/delivered', deliveryAuthMiddleware, async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (order.status !== 'out_for_delivery') {
    return res.status(400).json({ error: 'Pedido não está em rota de entrega' });
  }

  db.prepare("UPDATE orders SET status = 'delivered', updated_at = datetime('now','localtime') WHERE id = ?")
    .run(req.params.id);
  await notifyOrderStatus(null, req.params.id, 'delivered');
  res.json({ ok: true });
});

module.exports = router;
