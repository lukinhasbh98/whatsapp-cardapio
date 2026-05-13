const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../../database/db');
const router = express.Router();

// ── Admin login ──────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const isBcryptHash = adminPassword.startsWith('$2');
  const valid = isBcryptHash
    ? await bcrypt.compare(password, adminPassword).catch(() => false)
    : password === adminPassword;
  if (!valid) return res.status(401).json({ error: 'Senha incorreta' });
  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET || 'secret', { expiresIn: '12h' });
  res.json({ token });
});

// ── Delivery login ───────────────────────────────────────────────────────────
router.post('/delivery-login', async (req, res) => {
  const { password } = req.body;
  const deliveryPassword = db.getSetting('delivery_password') || '';
  if (!deliveryPassword) return res.status(403).json({ error: 'Acesso de entregador não configurado pelo administrador.' });
  const isBcryptHash = deliveryPassword.startsWith('$2');
  const valid = isBcryptHash
    ? await bcrypt.compare(password, deliveryPassword).catch(() => false)
    : password === deliveryPassword;
  if (!valid) return res.status(401).json({ error: 'Senha incorreta' });
  const token = jwt.sign({ role: 'delivery' }, process.env.JWT_SECRET || 'secret', { expiresIn: '24h' });
  res.json({ token });
});

// ── Customer register ────────────────────────────────────────────────────────
router.post('/customer-register', async (req, res) => {
  const { name, email, phone, address, password } = req.body;

  if (!name || name.trim().length < 2)
    return res.status(400).json({ error: 'Nome inválido (mínimo 2 caracteres).' });
  if (!email || !email.includes('@'))
    return res.status(400).json({ error: 'E-mail inválido.' });
  if (!phone || phone.replace(/\D/g, '').length < 10)
    return res.status(400).json({ error: 'Telefone inválido.' });
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres.' });

  const cleanEmail = email.toLowerCase().trim();
  const cleanPhone = phone.replace(/\D/g, '');
  const cleanName  = name.trim();
  const cleanAddr  = (address || '').trim();

  // E-mail já cadastrado em outro número
  const byEmail = db.prepare('SELECT id, phone FROM customers WHERE email = ?').get(cleanEmail);
  if (byEmail && byEmail.phone !== cleanPhone)
    return res.status(409).json({ error: 'E-mail já cadastrado com outro número de telefone.' });

  const hash = await bcrypt.hash(password, 10);
  const byPhone = db.prepare('SELECT * FROM customers WHERE phone = ?').get(cleanPhone);

  let customerId;
  if (byPhone) {
    db.prepare('UPDATE customers SET name = ?, email = ?, password_hash = ?, last_address = COALESCE(NULLIF(?,\'\'), last_address) WHERE phone = ?')
      .run(cleanName, cleanEmail, hash, cleanAddr, cleanPhone);
    customerId = byPhone.id;
  } else {
    const r = db.prepare('INSERT INTO customers (phone, name, email, password_hash, last_address) VALUES (?,?,?,?,?)')
      .run(cleanPhone, cleanName, cleanEmail, hash, cleanAddr);
    customerId = r.lastInsertRowid;
  }

  const token = jwt.sign({ role: 'customer', customerId, phone: cleanPhone }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
  res.json({ token, name: cleanName });
});

// ── Customer login ───────────────────────────────────────────────────────────
router.post('/customer-login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });

  const customer = db.prepare('SELECT * FROM customers WHERE email = ?').get(email.toLowerCase().trim());
  if (!customer || !customer.password_hash)
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });

  const valid = await bcrypt.compare(password, customer.password_hash).catch(() => false);
  if (!valid) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });

  const token = jwt.sign({ role: 'customer', customerId: customer.id, phone: customer.phone }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
  res.json({ token, name: customer.name });
});

// ── Middlewares ──────────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Não autorizado' });
  try {
    const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'secret');
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Acesso negado' });
    next();
  } catch { res.status(401).json({ error: 'Token inválido' }); }
}

function deliveryAuthMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Não autorizado' });
  try {
    const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'secret');
    if (!['admin', 'delivery'].includes(payload.role)) return res.status(403).json({ error: 'Acesso negado' });
    next();
  } catch { res.status(401).json({ error: 'Token inválido' }); }
}

function customerAuthMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Não autorizado' });
  try {
    const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'secret');
    if (payload.role !== 'customer') return res.status(403).json({ error: 'Acesso negado' });
    req.customer = { id: payload.customerId, phone: payload.phone };
    next();
  } catch { res.status(401).json({ error: 'Token inválido' }); }
}

module.exports = { router, authMiddleware, deliveryAuthMiddleware, customerAuthMiddleware };
