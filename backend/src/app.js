const express = require('express');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const healthRouter = require('./routes/health');
const ordersRouter   = require('./routes/orders');
const adminRouter    = require('./routes/admin');
const settingsRouter       = require('./routes/settings');
const conversationsRouter  = require('./routes/conversations');
const supportRouter        = require('./routes/support');
const usersRouter          = require('./routes/users');
const walletRouter         = require('./routes/wallet');
const listingsRouter       = require('./routes/listings');
const profileRouter        = require('./routes/profile');
const forumRouter          = require('./routes/forum');
const gostRouter           = require('./routes/gost');
const statsRouter          = require('./routes/stats');
const { startForumAIJob }  = require('./utils/forumModerator');

const app = express();

// Behind a hosting proxy (Render/Railway/etc.) — needed for correct client IPs
// in rate limiting. Trust only the first hop.
app.set('trust proxy', 1);

// Secure HTTP headers. This is a JSON API (no server-rendered HTML), so the
// strict-by-default CSP/embedder policies add no value and can interfere.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// Basic abuse protection: cap requests per IP. Generous enough for normal use
// (chat polls every 5s), but stops scraping/brute-force bursts.
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте позже.' },
}));

const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length
    ? (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error('Not allowed by CORS'));
      }
    : '*',
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
app.use('/profile',        profileRouter);
app.use('/forum',          forumRouter);
app.use('/gost',           gostRouter);
app.use('/stats',          statsRouter);

// Start background AI forum moderation (fire-and-forget, every 10 min)
startForumAIJob();

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
