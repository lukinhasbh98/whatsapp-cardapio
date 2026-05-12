const express = require('express');
const path = require('path');
const multer = require('multer');
const db = require('../../database/db');
const { authMiddleware } = require('./auth');
const { notifyOrderStatus, getBotStatus } = require('../../services/notifier');
const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../../admin/uploads'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ── Categories ─────────────────────────────────────────────────────────────
router.get('/categories', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY sort_order').all());
});

router.post('/categories', authMiddleware, (req, res) => {
  const { name, emoji, sort_order } = req.body;
  const result = db.prepare('INSERT INTO categories (name, emoji, sort_order) VALUES (?, ?, ?)').run(name, emoji || '', sort_order || 0);
  res.json({ id: result.lastInsertRowid });
});

router.put('/categories/:id', authMiddleware, (req, res) => {
  const { name, emoji, sort_order, active } = req.body;
  db.prepare('UPDATE categories SET name=?, emoji=?, sort_order=?, active=? WHERE id=?')
    .run(name, emoji, sort_order, active, req.params.id);
  res.json({ ok: true });
});

router.delete('/categories/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Menu Items ──────────────────────────────────────────────────────────────
router.get('/items', authMiddleware, (req, res) => {
  const { category_id } = req.query;
  const items = category_id
    ? db.prepare('SELECT * FROM menu_items WHERE category_id = ?').all(category_id)
    : db.prepare('SELECT mi.*, c.name as category_name FROM menu_items mi JOIN categories c ON c.id = mi.category_id').all();
  res.json(items);
});

router.post('/items', authMiddleware, upload.single('image'), (req, res) => {
  const { category_id, name, description, price } = req.body;
  const image_url = req.file ? `/uploads/${req.file.filename}` : '';
  const result = db.prepare('INSERT INTO menu_items (category_id, name, description, price, image_url) VALUES (?, ?, ?, ?, ?)')
    .run(category_id, name, description || '', parseFloat(price), image_url);
  res.json({ id: result.lastInsertRowid });
});

router.put('/items/:id', authMiddleware, upload.single('image'), (req, res) => {
  const { name, description, price, active, category_id } = req.body;
  const image_url = req.file ? `/uploads/${req.file.filename}` : undefined;
  if (image_url !== undefined) {
    db.prepare('UPDATE menu_items SET name=?, description=?, price=?, active=?, category_id=?, image_url=? WHERE id=?')
      .run(name, description, parseFloat(price), active, category_id, image_url, req.params.id);
  } else {
    db.prepare('UPDATE menu_items SET name=?, description=?, price=?, active=?, category_id=? WHERE id=?')
      .run(name, description, parseFloat(price), active, category_id, req.params.id);
  }
  res.json({ ok: true });
});

router.delete('/items/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Item Extras ─────────────────────────────────────────────────────────────
router.get('/items/:id/extras', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM item_extras WHERE item_id = ?').all(req.params.id));
});

router.post('/items/:id/extras', authMiddleware, (req, res) => {
  const { name, price } = req.body;
  const result = db.prepare('INSERT INTO item_extras (item_id, name, price) VALUES (?, ?, ?)').run(req.params.id, name, parseFloat(price));
  res.json({ id: result.lastInsertRowid });
});

router.delete('/extras/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM item_extras WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Orders ──────────────────────────────────────────────────────────────────
router.get('/orders', authMiddleware, (req, res) => {
  const { status, date_from, date_to, limit = 200 } = req.query;
  const conditions = [];
  const params = [];

  if (status)    { conditions.push('status = ?');                params.push(status); }
  if (date_from) { conditions.push("date(created_at) >= ?");     params.push(date_from); }
  if (date_to)   { conditions.push("date(created_at) <= ?");     params.push(date_to); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(parseInt(limit));

  const orders = db.prepare(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT ?`).all(...params);
  res.json(orders);
});

router.get('/orders/:id', authMiddleware, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id);
  res.json({ ...order, items });
});

router.put('/orders/:id/status', authMiddleware, async (req, res) => {
  const { status } = req.body;
  const allowed = ['confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Status inválido' });

  db.prepare('UPDATE orders SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(status, req.params.id);
  await notifyOrderStatus(null, req.params.id, status);
  res.json({ ok: true });
});

// ── Settings ─────────────────────────────────────────────────────────────────
router.get('/settings', authMiddleware, (req, res) => {
  res.json(db.getAllSettings());
});

router.put('/settings', authMiddleware, (req, res) => {
  const updates = req.body;
  for (const [key, value] of Object.entries(updates)) {
    db.setSetting(key, value);
  }
  res.json({ ok: true });
});

// ── Bot Status ───────────────────────────────────────────────────────────────
router.get('/bot-status', authMiddleware, (req, res) => {
  res.json(getBotStatus());
});

// ── Stats ────────────────────────────────────────────────────────────────────
router.get('/stats', authMiddleware, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const from = req.query.date_from || today;
  const to   = req.query.date_to   || today;
  const stats = {
    orders_today:   db.prepare("SELECT COUNT(*) as c FROM orders WHERE date(created_at) BETWEEN ? AND ?").get(from, to)?.c || 0,
    revenue_today:  db.prepare("SELECT COALESCE(SUM(total),0) as t FROM orders WHERE date(created_at) BETWEEN ? AND ? AND status != 'cancelled'").get(from, to)?.t || 0,
    orders_pending: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status IN ('confirmed','preparing')").get()?.c || 0,
    avg_rating:     db.prepare("SELECT ROUND(AVG(score),1) as a FROM ratings").get()?.a || 0,
  };
  res.json(stats);
});

module.exports = router;
