const { STATES } = require('../sessionManager');

async function askAddress(sock, phone, session) {
  const customer = session.returningCustomer;
  let msg = `📍 *ENDEREÇO DE ENTREGA*\n\n`;

  if (customer && customer.last_address) {
    msg += `Seu último endereço:\n_${customer.last_address}_\n\n`;
    msg += `1️⃣ Usar este endereço\n2️⃣ Informar novo endereço`;
    session.state = STATES.CONFIRM_ADDRESS;
  } else {
    msg += `Por favor, digite seu endereço completo:\n_Rua, número, bairro, complemento (se houver)_`;
    session.state = STATES.AWAITING_ADDRESS;
  }

  await sock.sendMessage(phone, { text: msg });
}

async function handleAddressInput(sock, phone, session, text) {
  if (session.state === STATES.CONFIRM_ADDRESS) {
    if (text === '1') {
      session.address = session.returningCustomer.last_address;
      await confirmAddress(sock, phone, session);
    } else {
      session.state = STATES.AWAITING_ADDRESS;
      await sock.sendMessage(phone, {
        text: `📍 Digite seu novo endereço completo:\n_Rua, número, bairro, complemento_`,
      });
    }
    return;
  }

  if (session.state === STATES.AWAITING_ADDRESS) {
    if (text.trim().length < 10) {
      await sock.sendMessage(phone, {
        text: `⚠️ Endereço muito curto. Por favor, informe o endereço completo:\n_Ex: Rua das Flores, 123, Centro, apto 45_`,
      });
      return;
    }
    session.address = text.trim();
    await confirmAddress(sock, phone, session);
  }
}

async function confirmAddress(sock, phone, session) {
  session.state = STATES.PAYMENT_METHOD;
  await sock.sendMessage(phone, {
    text: `📍 Endereço confirmado:\n*${session.address}*\n\n✅ Ótimo! Agora escolha a forma de pagamento:\n\n1️⃣ 💸 PIX\n2️⃣ 💵 Dinheiro\n3️⃣ 💳 Cartão (maquininha com entregador)\n\n_Digite o número_`,
  });
}

module.exports = { askAddress, handleAddressInput };
