const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

const verifyToken = (req, res, next) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Token tidak ditemukan' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    
    // Pastikan payload memiliki ID
    if (!payload.id) {
      return res.status(401).json({ message: 'Token tidak valid: missing user ID' });
    }
    
    req.user = payload;
    next();
  } catch (err) {
    console.error('Token verification error:', err.message);
    return res.status(401).json({ message: 'Token tidak valid atau expired' });
  }
};

module.exports = { verifyToken };