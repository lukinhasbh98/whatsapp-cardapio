require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const { router: authRouter } = require('./routes/auth');
const adminRouter = require('./routes/admin');
const deliveryRouter = require('./routes/delivery');
const { router: webhookRouter, init: initWebhook } = require('./routes/webhook');
const { init: initNotifier } = require('../services/notifier');

function createServer(sock) {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });

  // Make sure uploads dir exists
  const uploadsDir = path.join(__dirname, '../../admin/uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  app.use(cors());
  app.use(express.json());

  // Webhook must receive raw body for signature validation
  app.use('/webhook', webhookRouter);

  app.use(express.urlencoded({ extended: true }));
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/delivery', deliveryRouter);
  app.use('/uploads', express.static(uploadsDir));
  app.use(express.static(path.join(__dirname, '../../admin')));

  // Catch-all: serve admin panel
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../admin/index.html'));
  });


  initWebhook(sock);
  initNotifier(sock, io);

  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => {
    console.log(`✅ Painel admin disponível em http://localhost:${PORT}`);
  });

  return { app, io };
}

module.exports = { createServer };
