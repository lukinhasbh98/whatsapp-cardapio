const express = require('express');
const crypto = require('crypto');
const db = require('../../database/db');
const router = express.Router();

let _sock = null;
function init(sock) { _sock = sock; }

router.post('/mercadopago', express.raw({ type: 'application/json' }), async (req, res) => {
  // Validate Mercado Pago signature
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (secret) {
    const xSignature = req.headers['x-signature'] || '';
    const xRequestId = req.headers['x-request-id'] || '';
    const queryString = req.url.includes('?') ? req.url.split('?')[1] : '';
    const dataId = req.query?.data?.id || '';

    const manifest = `id:${dataId};request-id:${xRequestId};ts:${xSignature.split(',').find(p => p.startsWith('ts='))?.slice(3) || ''}`;
    const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    const receivedHash = xSignature.split(',').find(p => p.startsWith('v1='))?.slice(3) || '';

    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(receivedHash.padEnd(hmac.length, '0')))) {
      return res.sendStatus(401);
    }
  }

  res.sendStatus(200); // Acknowledge immediately

  try {
    const body = JSON.parse(req.body.toString());
    if (body.type !== 'payment' || !body.data?.id) return;

    const paymentId = body.data.id;
    const { getPaymentStatus } = require('../../services/mercadopago');
    const status = await getPaymentStatus(paymentId);

    if (status === 'approved') {
      const order = db.prepare('SELECT * FROM orders WHERE mp_payment_id = ?').get(String(paymentId));
      if (!order || order.status !== 'awaiting_payment') return;

      db.prepare("UPDATE orders SET status = 'confirmed' WHERE id = ?").run(order.id);

      const { confirmPixPayment } = require('../../bot/handlers/paymentHandler');
      const customerJid = `${order.customer_phone.replace(/\D/g, '')}@s.whatsapp.net`;
      if (_sock) await confirmPixPayment(_sock, customerJid, order.id);
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }
});

module.exports = { router, init };
