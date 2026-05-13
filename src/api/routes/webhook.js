const express = require('express');
const db = require('../../database/db');
const { emitOrderUpdate } = require('../../services/notifier');
const router = express.Router();

let _sock = null;
function init(sock) { _sock = sock; }

router.post('/mercadopago', async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately

  try {
    const body = req.body;
    if (body.type !== 'payment' || !body.data?.id) return;

    const paymentId = body.data.id;
    const { getPaymentStatus } = require('../../services/mercadopago');
    const status = await getPaymentStatus(paymentId);

    if (status === 'approved') {
      const order = db.prepare('SELECT * FROM orders WHERE mp_payment_id = ?').get(String(paymentId));
      if (!order || order.status !== 'awaiting_payment') return;

      db.prepare("UPDATE orders SET status = 'confirmed', updated_at = datetime('now','localtime') WHERE id = ?").run(order.id);

      // Notifica painel admin e loja em tempo real via socket
      emitOrderUpdate(order.id, 'confirmed');
      console.log(`[Webhook] PIX confirmado — Pedido #${order.id}`);

      // Notifica cliente via WhatsApp (se bot estiver conectado)
      const { confirmPixPayment } = require('../../bot/handlers/paymentHandler');
      const customerJid = `${order.customer_phone.replace(/\D/g, '')}@s.whatsapp.net`;
      if (_sock) await confirmPixPayment(_sock, customerJid, order.id);
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }
});

module.exports = { router, init };
