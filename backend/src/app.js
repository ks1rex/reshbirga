const express = require('express');
const multer = require('multer');
const cors = require('cors');
const healthRouter = require('./routes/health');
const ordersRouter   = require('./routes/orders');
const adminRouter    = require('./routes/admin');
const settingsRouter       = require('./routes/settings');
const conversationsRouter  = require('./routes/conversations');
const supportRouter        = require('./routes/support');
const usersRouter          = require('./routes/users');
const walletRouter         = require('./routes/wallet');
const listingsRouter       = require('./routes/listings');

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

app.use('/health', healthRouter);
app.use('/orders',   ordersRouter);
app.use('/admin',    adminRouter);
app.use('/settings',       settingsRouter);
app.use('/conversations',  conversationsRouter);
app.use('/support',        supportRouter);
app.use('/users',          usersRouter);
app.use('/wallet',         walletRouter);
app.use('/listings',       listingsRouter);

// 404 for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Не найдено' });
});

// Centralised error handler — keeps stack traces / internals server-side.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // File-upload validation (size / count / type)
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? 'Файл слишком большой (максимум 10 МБ)'
      : err.code === 'LIMIT_FILE_COUNT'
      ? 'Слишком много файлов (максимум 5)'
      : 'Ошибка загрузки файла';
    return res.status(400).json({ error: msg });
  }
  if (err?.status === 400) {
    return res.status(400).json({ error: err.message });
  }
  // Malformed JSON body
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректный формат запроса' });
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера. Попробуйте позже.' });
});

module.exports = app;
