require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const bapbRoutes = require('./routes/bapb');
const bappRoutes = require('./routes/bapp');
const docsRoutes = require('./routes/documents');
const uploadRoutes = require('./routes/upload');
const notificationsRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 4000;

/* =======================
   CORS CONFIG (NETLIFY)
======================= */
const allowedOrigins = [
  'https://digiba-asah.netlify.app',
  'http://localhost:5173',
  'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

/* =======================
   MIDDLEWARE
======================= */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet());

/* =======================
   RATE LIMIT
======================= */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 5000 : 3000,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(apiLimiter);

/* =======================
   ROUTES
======================= */
app.use('/api/auth', authRoutes);
app.use('/api/bapb', bapbRoutes);
app.use('/api/bapp', bappRoutes);
app.use('/api/documents', docsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/notifications', notificationsRoutes);

/* =======================
   HEALTH CHECK
======================= */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

/* =======================
   STATIC
======================= */
app.use('/uploads', express.static('uploads'));

/* =======================
   ERROR HANDLER
======================= */
app.use((err, req, res, next) => {
  console.error('🔥 SERVER ERROR:', err.message);
  res.status(500).json({
    message: 'Internal server error',
    error: err.message
  });
});

/* =======================
   START SERVER
======================= */
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  console.log(`🌐 API: /api/*`);
});
