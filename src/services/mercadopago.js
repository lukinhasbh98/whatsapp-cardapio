require('dotenv').config();
const { MercadoPagoConfig, Payment } = require('mercadopago');

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payment = new Payment(client);

async function createPixPayment(amount, orderId, customerPhone) {
  const response = await payment.create({
    body: {
      transaction_amount: amount,
      description: `Pedido #${String(orderId).padStart(4, '0')}`,
      payment_method_id: 'pix',
      external_reference: String(orderId),
      payer: {
        email: 'cliente@cardapio.bot',
        identification: { type: 'CPF', number: '00000000000' },
      },
      notification_url: `${process.env.WEBHOOK_BASE_URL}/webhook/mercadopago`,
    },
  });

  const txData = response.point_of_interaction?.transaction_data;
  return {
    id: response.id,
    qrCode: txData?.qr_code || '',
    qrCodeBase64: txData?.qr_code_base64 || '',
  };
}

async function getPaymentStatus(paymentId) {
  const response = await payment.get({ id: paymentId });
  return response.status;
}

module.exports = { createPixPayment, getPaymentStatus };
