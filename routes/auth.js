const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { verifyToken } = require('../middleware/auth');
const Joi = require('joi');

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// Skema validasi untuk registrasi vendor
const vendorRegisterSchema = Joi.object({
    nama_lengkap: Joi.string().min(3).required().messages({
        'string.base': 'Nama lengkap harus berupa teks',
        'string.empty': 'Nama lengkap tidak boleh kosong',
        'string.min': 'Nama lengkap minimal 3 karakter',
        'any.required': 'Nama lengkap wajib diisi',
    }),
    email: Joi.string().email().required().messages({
        'string.base': 'Email harus berupa teks',
        'string.empty': 'Email tidak boleh kosong',
        'string.email': 'Format email tidak valid',
        'any.required': 'Email wajib diisi',
    }),
    password: Joi.string().min(6).required().messages({
        'string.base': 'Password harus berupa teks',
        'string.empty': 'Password tidak boleh kosong',
        'string.min': 'Password minimal 6 karakter',
        'any.required': 'Password wajib diisi',
    }),
    perusahaan: Joi.string().allow('').optional(),
    no_telepon: Joi.string().allow('').optional(),
    alamat: Joi.string().allow('').optional(),
});

// POST /api/auth/login
// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { role, email, password } = req.body;

  console.log('\n🔍 ========== LOGIN ATTEMPT START ==========');
  console.log('📝 Request data:', { role, email, password: password ? '***' : 'empty' });

  if (!role || !email || !password) {
    return res.status(400).json({ 
      message: 'role, email, dan password wajib diisi'
    });
  }

  try {
    let tableName = null;
    let idColumn = null;
    
    if (role === 'vendor') {
      tableName = 'vendor';
      idColumn = 'id_vendor';
    } else if (role === 'pic') {
      tableName = 'pic';
      idColumn = 'id_pic';
    } else if (role === 'direksi') {
      tableName = 'direksi';
      idColumn = 'id_direksi';
    }
    
    console.log('📊 Role mapping:', { role, tableName, idColumn });

    if (!tableName) {
      return res.status(400).json({ 
        message: 'role tidak valid. Gunakan: vendor, pic, atau direksi'
      });
    }

    // Query user
    let rows = [];
    try {
      [rows] = await pool.query(
        `SELECT 
          ${idColumn} as id,
          email,
          nama_lengkap,
          password
         FROM ${tableName} 
         WHERE email = ?`,
        [email]
      );
      console.log(`✅ Query executed. Found ${rows.length} rows`);
    } catch (queryErr) {
      console.error('❌ Query error:', queryErr.message);
      return res.status(500).json({ 
        message: 'Error query database',
        error: queryErr.message 
      });
    }

    if (!rows || rows.length === 0) {
      console.log('❌ User not found with email:', email);
      return res.status(401).json({ 
        message: 'Email atau password tidak sesuai'
      });
    }

    const user = rows[0];
    console.log('👤 User found:', {
      id: user.id,
      email: user.email,
      nama_lengkap: user.nama_lengkap
    });

    // Compare password
    const match = await bcrypt.compare(password, user.password);
    console.log(`✅ bcrypt.compare result: ${match ? 'MATCH' : 'NO MATCH'}`);

    if (!match) {
      console.log('❌ Password tidak cocok');
      return res.status(401).json({ 
        message: 'Email atau password tidak sesuai'
      });
    }

    console.log('✅ Password validation SUCCESS');

    // Generate JWT token
    const userPayload = {
      id: user.id,
      role: role,
      email: user.email,
      nama_lengkap: user.nama_lengkap || 'User'
    };

    console.log('📦 User payload untuk JWT:', userPayload);

    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '8h' });

    console.log('✅ Login SUCCESSFUL');
    console.log('🔚 ========== LOGIN ATTEMPT END ==========\n');

    // HANYA SATU RESPONSE - jangan ada return/res.json lagi setelah ini
    res.json({
      message: 'Login berhasil',
      token,
      user: userPayload
    });

  } catch (err) {
    console.error('\n💥 UNEXPECTED ERROR:', err.message);
    // JANGAN kirim response jika sudah dikirim
    if (!res.headersSent) {
      res.status(500).json({ 
        message: 'Server error',
        error: err.message
      });
    }
  }
});

// REGISTER KHUSUS VENDOR - TANPA AUTO LOGIN
router.post('/register/vendor', async (req, res) => {
  const { 
    nama_lengkap, 
    email, 
    password, 
    perusahaan, 
    no_telepon, 
    alamat 
  } = req.body;

  console.log('\n📝 ========== VENDOR REGISTRATION ==========');
  console.log('📋 Registration data:', { 
    nama_lengkap, 
    email, 
    perusahaan: perusahaan || '(tidak diisi)',
    no_telepon: no_telepon ? '***' : 'empty',
    alamat: alamat ? '***' : 'empty'
  });

  // Validasi menggunakan Joi
  const { error } = vendorRegisterSchema.validate(req.body, { abortEarly: false });
  if (error) {
    console.log('❌ Registration validation failed:', error.details);
    const errorMessages = error.details.map(d => d.message).join(', ');
    return res.status(400).json({ 
      message: `Input tidak valid: ${errorMessages}`
    });
  }

  try {
    // Cek apakah email sudah terdaftar
    const [existing] = await pool.query(
      'SELECT id_vendor FROM vendor WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      console.log('❌ Email already registered:', email);
      return res.status(400).json({ 
        message: 'Email sudah terdaftar' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('🔐 Password hashed');

    // Insert ke database
    const [result] = await pool.query(
      `INSERT INTO vendor (
        nama_lengkap, 
        email, 
        password, 
        nama_perusahaan,
        alamat, 
        no_telepon, 
        jabatan,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        nama_lengkap, 
        email, 
        hashedPassword, 
        perusahaan || null, 
        alamat || '- belum diisi -',
        no_telepon || null, 
        'Vendor'
      ]
    );

    const vendorId = result.insertId;
    console.log('✅ Vendor registered with ID:', vendorId);

    console.log('✅ Registration SUCCESSFUL (NO AUTO LOGIN)');
    console.log('🔚 ========== REGISTRATION END ==========\n');

    // RESPONSE TANPA TOKEN - hanya konfirmasi sukses
    res.status(201).json({
      message: 'Registrasi vendor berhasil. Silakan login dengan email dan password Anda.',
      userId: vendorId,
      email: email,
      note: 'Silakan login ke sistem dengan kredensial yang telah didaftarkan'
    });

  } catch (err) {
    console.error('❌ Registration error:', err);
    console.error('❌ SQL Error details:', {
      code: err.code,
      errno: err.errno,
      sqlMessage: err.sqlMessage,
      sqlState: err.sqlState
    });
    
    let errorMessage = 'Server error';
    if (err.code === 'ER_NO_SUCH_TABLE') {
      errorMessage = 'Tabel vendor tidak ditemukan di database';
    } else if (err.code === 'ER_BAD_FIELD_ERROR') {
      errorMessage = `Kolom tidak ditemukan: ${err.sqlMessage}`;
    } else if (err.code === 'ER_BAD_NULL_ERROR') {
      errorMessage = `Kolom wajib tidak diisi: ${err.sqlMessage}`;
    } else if (err.code === 'ER_NO_DEFAULT_FOR_FIELD') {
      errorMessage = `Kolom '${err.sqlMessage.match(/Field '(.+)' doesn't/)?.[1] || 'unknown'}' tidak memiliki nilai default`;
    }
    
    res.status(500).json({ 
      message: errorMessage, 
      error: err.message,
      sqlError: err.sqlMessage
    });
  }
});

// POST /api/auth/change-password
router.post('/change-password', verifyToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const { id, role } = req.user;

  console.log('\n🔑 ========== CHANGE PASSWORD ==========');
  console.log('📝 Request from user:', { id, role });

  if (!currentPassword || !newPassword) {
    console.log('❌ Missing password fields');
    return res.status(400).json({ 
      message: 'currentPassword dan newPassword wajib diisi' 
    });
  }

  try {
    let tableName = null;
    let idColumn = null;
    
    if (role === 'vendor') {
      tableName = 'vendor';
      idColumn = 'id_vendor';
    } else if (role === 'pic') {
      tableName = 'pic';
      idColumn = 'id_pic';
    } else {
      tableName = 'direksi';
      idColumn = 'id_direksi';
    }

    console.log(`🔍 Querying ${tableName} table for user id: ${id}`);
    
    const [rows] = await pool.query(
      `SELECT password FROM ${tableName} WHERE ${idColumn} = ?`,
      [id]
    );

    if (!rows || rows.length === 0) {
      console.log('❌ User not found');
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    const currentPasswordHash = rows[0].password;
    const match = await bcrypt.compare(currentPassword, currentPasswordHash);
    
    if (!match) {
      console.log('❌ Current password incorrect');
      return res.status(400).json({ message: 'Password saat ini salah' });
    }

    console.log('✅ Current password verified');
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    await pool.query(
      `UPDATE ${tableName} SET password = ?, updated_at = NOW() WHERE ${idColumn} = ?`,
      [hashedPassword, id]
    );

    console.log('✅ Password changed successfully');
    console.log('🔚 ========== CHANGE PASSWORD END ==========\n');

    res.json({ 
      message: 'Password berhasil diubah'
    });
    
  } catch (err) {
    console.error('❌ Change password error:', err);
    res.status(500).json({ 
      message: 'Server error', 
      error: err.message 
    });
  }
});

// GET /api/auth/verify (untuk testing token)
router.get('/verify', verifyToken, (req, res) => {
  console.log('\n✅ Token verification successful');
  console.log('👤 User from token:', req.user);
  
  res.json({
    message: 'Token valid',
    user: req.user
  });
});

// GET /api/auth/profile - Get full user profile
router.get('/profile', verifyToken, async (req, res) => {
  const { id, role } = req.user;

  try {
    let query;
    let tableName;
    let idColumn;

    if (role === 'vendor') {
      tableName = 'vendor';
      idColumn = 'id_vendor';
      query = `SELECT id_vendor as id, email, nama_lengkap, nama_perusahaan as perusahaan, alamat, no_telepon, created_at FROM ${tableName} WHERE ${idColumn} = ?`;
    } else if (role === 'pic') {
      tableName = 'pic';
      idColumn = 'id_pic';
      query = `SELECT id_pic as id, email, nama_lengkap, jabatan, created_at FROM ${tableName} WHERE ${idColumn} = ?`;
    } else if (role === 'direksi') {
      tableName = 'direksi';
      idColumn = 'id_direksi';
      query = `SELECT id_direksi as id, email, nama_lengkap, jabatan, created_at FROM ${tableName} WHERE ${idColumn} = ?`;
    } else {
      return res.status(400).json({ message: 'Role tidak valid' });
    }

    const [rows] = await pool.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    const userProfile = { ...rows[0], role };
    res.json(userProfile);

  } catch (err) {
    console.error('Error fetching profile:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;