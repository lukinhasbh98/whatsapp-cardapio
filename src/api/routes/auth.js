const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
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

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Não autorizado' });
  try {
    jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'secret');
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

module.exports = { router, authMiddleware };
