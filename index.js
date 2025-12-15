require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const bapbRoutes = require('./routes/bapb');
const bappRoutes = require('./routes/bapp');
const docsRoutes = require('./routes/documents');
const uploadRoutes = require('./routes/upload');
const notificationsRoutes = require('./routes/notifications'); // Add this line
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet());
const isDevelopment = process.env.NODE_ENV === 'development';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 5000 : 3000, // Higher limit for dev, standard for prod
  standardHeaders: true, 
  legacyHeaders: false, 
  message: {
    message: 'Terlalu banyak permintaan dari IP ini, silakan coba lagi setelah 15 menit.',
  },
});

app.use(apiLimiter);


// Routes - PASTIKAN authRoutes ADA DI SINI
app.use('/api/auth', authRoutes);
app.use('/api/bapb', bapbRoutes);
app.use('/api/bapp', bappRoutes);
app.use('/api/documents', docsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/notifications', notificationsRoutes); // Add this line

app.get('/api/health', (req, res) => {
  res.json({ status: 'Server running OK', timestamp: new Date().toISOString() });
});

// Test route untuk register
app.get('/api/test-register', (req, res) => {
  res.json({ message: 'Register endpoint should be at /api/auth/register/vendor' });
});

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ message: 'Internal server error', error: err.message });
});

app.listen(PORT, () => {
  console.log(` Backend server running on http://localhost:${PORT}`);
  console.log(` API endpoints available at http://localhost:${PORT}/api/*`);
  console.log(` Register: POST http://localhost:${PORT}/api/auth/register/vendor`);
});

app.use('/uploads', express.static('uploads'));

