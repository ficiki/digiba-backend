const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');
const fs = require('fs'); // Moved fs import to the top

// Konfigurasi penyimpanan file untuk lampiran dokumen
const documentStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/documents/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir); // Simpan lampiran di folder 'uploads/documents'
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// Konfigurasi penyimpanan file untuk tanda tangan (signature)
const signatureStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/signatures/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir); // Simpan tanda tangan di folder 'uploads/signatures'
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'signature-' + req.user.id + '-' + uniqueSuffix + path.extname(file.originalname)); // Nama file: signature-userId-timestamp.ext
  }
});

// Filter file yang diizinkan untuk dokumen
const documentFileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Hanya file gambar, PDF, dan Word yang diizinkan untuk dokumen'));
  }
};

// Filter file yang diizinkan untuk tanda tangan (hanya gambar)
const imageFileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Hanya file gambar (JPG, JPEG, PNG) yang diizinkan untuk tanda tangan'));
  }
};

const uploadDocuments = multer({
  storage: documentStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: documentFileFilter
});

const uploadSignature = multer({
  storage: signatureStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max for signature
  fileFilter: imageFileFilter
});

// POST /api/upload/:jenis/:id - Upload lampiran untuk dokumen
router.post('/:jenis/:id', verifyToken, uploadDocuments.array('files', 5), async (req, res) => {
  const { jenis, id } = req.params;
  const { role, id: userId } = req.user;
  const { keterangan } = req.body;

  // Validasi jenis dokumen
  if (!['bapb', 'bapp'].includes(jenis)) {
    return res.status(400).json({ message: 'Jenis dokumen tidak valid' });
  }

  try {
    // Validasi dokumen exists dan milik vendor (jika vendor)
    let tableName = jenis === 'bapb' ? 'bapb' : 'bapp';
    let idColumn = jenis === 'bapb' ? 'id_bapb' : 'id_bapp';
    
    const [doc] = await pool.query(
      `SELECT * FROM ${tableName} WHERE ${idColumn} = ?`,
      [id]
    );

    if (!doc || doc.length === 0) {
      return res.status(404).json({ message: 'Dokumen tidak ditemukan' });
    }

    const document = doc[0];

    // Authorization: vendor hanya bisa upload ke dokumen miliknya
    if (role === 'vendor' && document.id_vendor !== userId) {
      return res.status(403).json({ 
        message: 'Anda tidak memiliki akses ke dokumen ini' 
      });
    }

    // Authorization: hanya draft yang bisa ditambah lampiran oleh vendor
    if (role === 'vendor' && document.status !== 'draft') {
      return res.status(400).json({ 
        message: 'Hanya dokumen dengan status draft yang bisa ditambah lampiran' 
      });
    }

        // Start transaction
        await pool.query('START TRANSACTION');
    
        const uploadedFiles = [];
    
        // Log file and keterangan details for debugging
        console.log('--- Uploading Files Details ---');
        console.log('Request body Keterangan:', keterangan);
        req.files.forEach((file, index) => {
          console.log(`File ${index + 1}:`);
          console.log('  Originalname:', file.originalname);
          console.log('  Filename (saved):', file.filename);
          console.log('  Mimetype:', file.mimetype);
          console.log('  Size:', file.size);
        });
        console.log('-----------------------------');
    
        // Simpan setiap file ke database
        for (const file of req.files) {
          const fileExtension = path.extname(file.originalname).substring(1); // e.g., 'jpeg', 'pdf'
          const fileType = file.mimetype.split('/')[0]; // e.g., 'image', 'application'
          const usedKeterangan = keterangan || `Lampiran diunggah oleh ${req.user.nama_lengkap || 'User'}`;
          const uploaderName = req.user.nama_lengkap || 'User';
    
          const [result] = await pool.query(
      `INSERT INTO lampiran 
       (jenis_dokumen, id_dokumen, nama_file_asli, nama_file_tersimpan, tipe_file, nama_asli, mime_type, ukuran_file, keterangan, uploaded_by, uploaded_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        jenis,
        id,
        file.originalname,
        file.filename, // Store the unique filename generated by Multer
        fileExtension, // Populate tipe_file
        file.originalname, // Populate nama_asli (assuming it's same as nama_file_asli)
        file.mimetype,
        file.size,
        usedKeterangan,
        uploaderName, // Populate uploaded_by
      ]
    );
    
          uploadedFiles.push({
            id: result.insertId,
            nama_file_asli: file.originalname,
            nama_file_tersimpan: file.filename,
            mime_type: file.mimetype,
            ukuran_file: file.size,
            path: `/uploads/documents/${file.filename}` // Dynamic path for response/frontend display
          });
        }
    
        // Add to history jika ada file yang diupload
        if (uploadedFiles.length > 0) {
          await pool.query(
            `INSERT INTO document_history (
              jenis_dokumen, id_dokumen, action, actor_role, actor_id, 
              actor_name, details, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
              jenis,
              id,
              'upload_lampiran',
              role,
              userId,
              req.user.nama_lengkap || 'User',
              JSON.stringify({ 
                jumlah_file: uploadedFiles.length,
                files: uploadedFiles.map(f => f.nama_file_asli)
              })
            ]
          );
        }
    
        await pool.query('COMMIT');
    
        res.status(201).json({
          message: `${uploadedFiles.length} file berhasil diupload`,
          files: uploadedFiles
        });
    
      } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Upload error:', err);
        console.error('Detailed upload error:', err.message); // Added detailed error logging
        
        // Hapus file yang sudah diupload jika error
        if (req.files && req.files.length > 0) {
          req.files.forEach(file => {
            const fs = require('fs');
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
          });
        }
        
        res.status(500).json({ 
          message: 'Upload gagal', 
          error: err.message 
        });
      }
    });// POST /api/upload/signature - Upload user's digital signature
router.post('/signature', verifyToken, uploadSignature.single('signature'), async (req, res) => {
  const { id: userId, role } = req.user;

  if (role !== 'pic') {
    return res.status(403).json({ message: 'Akses ditolak: Hanya PIC yang dapat mengunggah tanda tangan.' });
  }

  if (!req.file) {
    return res.status(400).json({ message: 'Tidak ada file tanda tangan yang diunggah.' });
  }

  try {
    const signaturePath = `/uploads/signatures/${req.file.filename}`;

    await pool.query(
      'UPDATE users SET signature_url = ? WHERE id_user = ?',
      [signaturePath, userId]
    );

    res.status(200).json({
      message: 'Tanda tangan berhasil diunggah dan disimpan.',
      signatureUrl: signaturePath
    });

  } catch (err) {
    console.error('Signature upload error:', err);
    // If database update fails, delete the uploaded file
    const fs = require('fs');
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      message: 'Gagal mengunggah tanda tangan.',
      error: err.message
    });
  }
});

// DELETE /api/upload/:id - Hapus lampiran
router.delete('/:id', verifyToken, async (req, res) => {
  const { id } = req.params; // id here is id_lampiran
  const { role, id: userId } = req.user;

  try {
    // 1. Get lampiran info
    const [attachments] = await pool.query(
      `SELECT id_lampiran, jenis_dokumen, id_dokumen, nama_file_tersimpan, nama_file_asli
       FROM lampiran
       WHERE id_lampiran = ?`,
      [id]
    );

    if (!attachments || attachments.length === 0) {
      return res.status(404).json({ message: 'Lampiran tidak ditemukan' });
    }
    const attachment = attachments[0];
    const { jenis_dokumen, id_dokumen, nama_file_tersimpan, nama_file_asli } = attachment;

    // 2. Fetch Parent Document Details for Authorization
    let document;
    if (role === 'vendor') {
      let tableName = jenis_dokumen === 'bapb' ? 'bapb' : 'bapp';
      let idColumn = jenis_dokumen === 'bapb' ? 'id_bapb' : 'id_bapp';

      const [docs] = await pool.query(
        `SELECT id_vendor, status FROM ${tableName} WHERE ${idColumn} = ?`,
        [id_dokumen]
      );

      if (!docs || docs.length === 0) {
        return res.status(404).json({ message: 'Dokumen terkait tidak ditemukan' });
      }
      document = docs[0];

      // Authorization: vendor hanya bisa hapus lampiran di dokumen miliknya yang masih draft
      if (document.id_vendor !== userId) {
        return res.status(403).json({
          message: 'Anda tidak memiliki akses ke lampiran ini'
        });
      }
      if (document.status !== 'draft') {
        return res.status(400).json({
          message: 'Hanya bisa hapus lampiran pada dokumen dengan status draft'
        });
      }
    }

    // Start transaction
    await pool.query('START TRANSACTION');

    // 3. Delete from database
    await pool.query('DELETE FROM lampiran WHERE id_lampiran = ?', [id]);

    // 4. Delete physical file
    const fs = require('fs');
    const filePath = path.join(__dirname, '..', 'uploads', 'documents', nama_file_tersimpan);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    } else {
      console.warn(`File fisik tidak ditemukan untuk lampiran: ${filePath}`);
    }

    // 5. Add to history
    await pool.query(
      `INSERT INTO document_history (
        jenis_dokumen, id_dokumen, action, actor_role, actor_id,
        actor_name, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        jenis_dokumen,
        id_dokumen,
        'delete_lampiran',
        role,
        userId,
        req.user.nama_lengkap || 'User',
        JSON.stringify({
          nama_file: nama_file_asli
        })
      ]
    );

    await pool.query('COMMIT');

    res.json({
      message: 'Lampiran berhasil dihapus',
      id: id
    });

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Delete lampiran error:', err);
    res.status(500).json({
      message: 'Gagal menghapus lampiran',
      error: err.message
    });
  }
});

// GET /api/upload/download/:id - Download lampiran
router.get('/download/:id', verifyToken, async (req, res) => {
  const { id } = req.params; // id here is id_lampiran

  try {
    const [lampiran] = await pool.query(
      'SELECT nama_file_tersimpan, nama_file_asli FROM lampiran WHERE id_lampiran = ?',
      [id]
    );

    if (!lampiran || lampiran.length === 0) {
      return res.status(404).json({ message: 'File tidak ditemukan' });
    }

    const file = lampiran[0];
    const filePath = path.join(__dirname, '..', 'uploads', 'documents', file.nama_file_tersimpan);
    
    const fs = require('fs');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File tidak ditemukan di server' });
    }

    res.download(filePath, file.nama_file_asli);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ message: 'Download gagal', error: err.message });
  }
});

// GET /api/upload/:jenis/:id/list - List lampiran untuk dokumen
router.get('/:jenis/:id/list', verifyToken, async (req, res) => {
  const { jenis, id } = req.params;

  // Validasi jenis dokumen
  if (!['bapb', 'bapp'].includes(jenis)) {
    return res.status(400).json({ message: 'Jenis dokumen tidak valid' });
  }

  try {
    const [attachments] = await pool.query(
      `SELECT id_lampiran, nama_file_asli, mime_type, ukuran_file, uploaded_at 
       FROM lampiran 
       WHERE jenis_dokumen = ? AND id_dokumen = ?
       ORDER BY uploaded_at DESC`,
      [jenis, id]
    );

    res.json({
      message: 'Lampiran berhasil diambil',
      data: attachments.map(att => ({
        id_lampiran: att.id_lampiran,
        nama_file_asli: att.nama_file_asli,
        jenis_file: att.mime_type, // Use mime_type for compatibility with frontend
        ukuran: att.ukuran_file, // Add ukuran_file for frontend
        uploaded_at: att.uploaded_at
      }))
    });

  } catch (err) {
    console.error('GET attachments list error:', err);
    res.status(500).json({ message: 'Gagal mengambil daftar lampiran', error: err.message });
  }
});

module.exports = router;