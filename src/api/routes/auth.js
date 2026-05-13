const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../../database/db');
const router = express.Router();

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

// Admin only
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Não autorizado' });
  try {
    const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'secret');
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Acesso negado' });
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

// Delivery person or admin
function deliveryAuthMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Não autorizado' });
  try {
    const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'secret');
    if (!['admin', 'delivery'].includes(payload.role)) return res.status(403).json({ error: 'Acesso negado' });
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

module.exports = { router, authMiddleware, deliveryAuthMiddleware };
