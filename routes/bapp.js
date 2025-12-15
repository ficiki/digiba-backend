// server/routes/bapp.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');
const Joi = require('joi');
const { fetchDocumentRelations } = require('../utils/documentHelpers'); // Import the helper
const { getDireksiSignatureBase64 } = require('../utils/imageUtils'); // Import image utility

// Schema validation Joi
const bappSchema = Joi.object({
  nomor_bapp: Joi.string().required().label('Nomor BAPP'),
  no_kontrak: Joi.string().required().label('No Kontrak'),
  tanggal_kontrak: Joi.date().required().label('Tanggal Kontrak'),
  nilai_kontrak: Joi.number().positive().required().label('Nilai Kontrak'),
  lokasi_pekerjaan: Joi.string().required().label('Lokasi Pekerjaan'),
  rincian_pekerjaan: Joi.array().items(
    Joi.object({
      item: Joi.string().required().label('Item'), // Changed back to 'item'
      jumlah: Joi.number().positive().required().label('Jumlah'),
      satuan: Joi.string().required().label('Satuan'),
      harga_satuan: Joi.number().positive().required().label('Harga Satuan'),
      total: Joi.number().positive().required().label('Total'),
    })
  ).min(1).required().label('Rincian Pekerjaan'),
  hasil_pemeriksaan: Joi.string().required().label('Hasil Pemeriksaan'),
  keterangan: Joi.string().allow('').optional().label('Keterangan'),
  deadline: Joi.date().iso().optional().label('Deadline'), // Add deadline field
  status: Joi.string().valid('draft', 'submitted', 'reviewed_pic', 'approved_direksi').optional()
});

// POST /api/bapp - Buat BAPP baru
router.post('/', verifyToken, async (req, res) => {
  if (req.user.role !== 'vendor') {
    return res.status(403).json({ message: 'Akses ditolak' });
  }

  console.log('\n🚀 ========== CREATE BAPP START ==========');
  console.log('👤 User:', req.user.id, req.user.role);
  console.log('📋 Payload:', req.body);

  const { error: validationError } = bappSchema.validate(req.body);
  if (validationError) {
    console.error('❌ Validation error:', validationError.details);
    return res.status(400).json({ message: 'Input tidak valid', details: validationError.details });
  }

      const {
      nomor_bapp,
      no_kontrak,
      tanggal_kontrak,
      nilai_kontrak,
      lokasi_pekerjaan,
      rincian_pekerjaan, // Directly use the validated array from req.body
      hasil_pemeriksaan,
      keterangan,
      deadline // Destructure deadline
    } = req.body;
  
    const id_vendor = req.user.id;
  
    try {
      // Check unique nomor_bapp
      const [existing] = await pool.query('SELECT id_bapp FROM bapp WHERE nomor_bapp = ?', [nomor_bapp]);
      if (existing.length > 0) {
        console.log('❌ Duplicate nomor_bapp:', nomor_bapp);
        return res.status(409).json({ message: 'Nomor BAPP sudah ada' });
      }
  
      await pool.query('START TRANSACTION');
  
      const [insertResult] = await pool.query(
        `INSERT INTO bapp (
          nomor_bapp, id_vendor, no_kontrak, tanggal_kontrak, nilai_kontrak,
          lokasi_pekerjaan, rincian_pekerjaan, hasil_pemeriksaan, keterangan, deadline, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
        [
          nomor_bapp,
          id_vendor,
          no_kontrak,
          tanggal_kontrak,
          nilai_kontrak,
          lokasi_pekerjaan,
          JSON.stringify(rincian_pekerjaan),
          hasil_pemeriksaan,
          keterangan,
          deadline || null, // Add deadline here
        ]    );

    const docId = insertResult.insertId;

    // Insert history
    await pool.query(
      `INSERT INTO document_history (
        jenis_dokumen, id_dokumen, actor_role, actor_id, actor_name,
        aktivitas, keterangan, status_sebelum, status_sesudah
      ) VALUES ('bapp', ?, 'vendor', ?, ?, 'created', 'Dokumen BAPP dibuat', NULL, 'draft')`,
      [docId, id_vendor, req.user.nama_lengkap]
    );

    await pool.query('COMMIT');

    console.log('✅ BAPP created ID:', docId);
    console.log('🔚 ========== CREATE BAPP END ==========');

    res.status(201).json({
      message: 'Dokumen BAPP berhasil dibuat',
      id: docId
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('❌ Create BAPP error:', err.stack);
    res.status(500).json({ message: 'Gagal membuat dokumen BAPP', error: err.message });
  }
});

// GET /api/bapp - List BAPP (kode lama Anda, tambah log kalau perlu)
router.get('/', verifyToken, async (req, res) => {
  console.log('\n--- BAPP GET / Request ---');
  console.log('User Role:', req.user.role);
  console.log('User ID:', req.user.id);
  console.log('Query Params:', req.query);

  try {
    const {
      page = 1,
      limit = 10,
      status = '',
      search = ''
    } = req.query;

    const offset = (page - 1) * limit;
    let whereClause = 'WHERE 1=1';
    let params = [];

    // Filter berdasarkan role user
    if (req.user.role === 'vendor') {
      whereClause += ' AND b.id_vendor = ?';
      params.push(req.user.id);
    } else if (req.user.role === 'direksi') {
      // Allow direksi to see all documents, the status filter will narrow it down.
    }


    // Filter status
    if (status && status.length > 0) {
      const status_array = Array.isArray(status) ? status : status.split(',');
      if (status_array.length > 0) {
        whereClause += ` AND b.status IN (${status_array.map(() => '?').join(', ')})`;
        params.push(...status_array);
      }
    }

    // Search filter
    if (search) {
      whereClause += whereClause ? ' AND' : 'WHERE';
      whereClause += ' (b.nomor_bapp LIKE ? OR b.nama_projek LIKE ? OR b.no_kontrak LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    console.log('Constructed WHERE clause:', whereClause);
    console.log('Constructed Params:', params);

    // Query untuk count total
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM bapp b ${whereClause}`,
      params
    );
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    // Query untuk data
    const [rows] = await pool.query(
      `SELECT
        b.id_bapp as id,
        b.nomor_bapp,
        b.id_vendor,
        b.no_kontrak,
        b.tanggal_kontrak,
        b.nilai_kontrak,
        b.lokasi_pekerjaan,
        b.rincian_pekerjaan,
        b.hasil_pemeriksaan,
        b.keterangan,
        b.status,
        b.created_at,
        b.updated_at,
        b.direksi_signed_at,
        v.nama_lengkap as vendor_name,
        v.email as vendor_email
      FROM bapp b
      LEFT JOIN vendor v ON b.id_vendor = v.id_vendor
      ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // Parse rincian_pekerjaan JSON
    const data = rows.map(row => ({
      ...row,
      rincian_pekerjaan: (() => {
        try {
          return row.rincian_pekerjaan ? JSON.parse(row.rincian_pekerjaan) : [];
        } catch (e) {
          console.error('Error parsing rincian_pekerjaan JSON:', e);
          console.error('Malformed JSON string:', row.rincian_pekerjaan);
          return [row.rincian_pekerjaan]; // Return malformed string in array for visibility
        }
      })()
    }));

    console.log('Total Items:', totalItems);
    console.log('Returned Data Length:', data.length);
    console.log('Returned Document Statuses:', data.map(doc => doc.status));
    console.log('--- BAPP GET / Request End ---\n');

    res.json({
      data,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems,
        itemsPerPage: parseInt(limit)
      }
    });

  } catch (err) {
    console.error('GET BAPP error:', err);
    res.status(500).json({ message: 'Gagal mengambil data BAPP', error: err.message });
  }
});

// GET /api/bapp/:id - Get BAPP by ID
router.get('/:id', verifyToken, async (req, res) => {
  console.log('\n🔍 ========== GET BAPP BY ID START ==========');
  console.log('👤 User:', req.user.id, req.user.role);
  console.log('📄 Document ID:', req.params.id);

  const { id } = req.params;

  try {
    let query = `
      SELECT
        b.id_bapp as id,
        b.nomor_bapp,
        b.id_vendor,
        b.no_kontrak,
        b.tanggal_kontrak,
        b.nilai_kontrak as nilai,           -- Alias for frontend expectation
        b.lokasi_pekerjaan,
        b.rincian_pekerjaan,
        b.hasil_pemeriksaan,
        b.keterangan,
        b.status,
        b.created_at as tanggalDibuat,    -- Alias for frontend expectation
        b.updated_at,
        b.deadline,
        b.direksi_signed_at,
        v.nama_lengkap as vendor_name,
        v.email as vendor_email
      FROM bapp b
      LEFT JOIN vendor v ON b.id_vendor = v.id_vendor
      WHERE b.id_bapp = ?
    `;
    const params = [id];

    // Vendor can only see their own documents
    if (req.user.role === 'vendor') {
      query += ' AND b.id_vendor = ?';
      params.push(req.user.id);
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      console.log('❌ Document not found or access denied');
      return res.status(404).json({ message: 'Dokumen BAPP tidak ditemukan atau Anda tidak memiliki akses' });
    }

    const baseDocument = rows[0];

    // Fetch related data using the helper
    const { timeline, lampiran, picTerakhir } = await fetchDocumentRelations('bapp', id);

    const document = {
      ...baseDocument,
      type: 'bapp', // Hardcode type for frontend
      judul: baseDocument.lokasi_pekerjaan, // Use lokasi_pekerjaan as the title
      nomorSuratPesanan: baseDocument.no_kontrak, // Add nomorSuratPesanan from no_kontrak
      tanggal_kontrak: baseDocument.tanggal_kontrak, // Ensure date is not messed up by spread
      picTerakhir: picTerakhir, // Add picTerakhir
      timeline: timeline, // Add timeline
      lampiran: lampiran, // Add lampiran
      // nomorSuratPesanan and deadline are not available in BAPP, will be undefined/null as expected by frontend
    };

    // Parse rincian_pekerjaan JSON if it's a string
    if (typeof document.rincian_pekerjaan === 'string') {
        try {
            document.rincian_pekerjaan = JSON.parse(document.rincian_pekerjaan);
        } catch (e) {
            console.error('Error parsing rincian_pekerjaan JSON:', e);
            document.rincian_pekerjaan = []; // Default to empty array on parse error
        }
    }


    console.log('✅ Document found:', document.id);
    console.log('🔚 ========== GET BAPP BY ID END ==========');

    res.json(document);

  } catch (err) {
    console.error('❌ GET BAPP BY ID error:', err);
    res.status(500).json({ message: 'Gagal mengambil data BAPP', error: err.message });
  }
});

// DELETE /api/bapp/:id - Hapus BAPP
router.delete('/:id', verifyToken, async (req, res) => {
  console.log('\n🗑️ ========== DELETE BAPP START ==========');
  console.log('👤 User:', req.user.id, req.user.role, req.user.email);
  console.log('📄 Document ID:', req.params.id);

  if (req.user.role !== 'vendor') {
    console.log('❌ Access denied: not vendor');
    return res.status(403).json({ message: 'Akses ditolak: hanya vendor' });
  }

  const { id } = req.params;

  try {
    // Check if document exists and belongs to user
    const [existing] = await pool.query(
      'SELECT id_bapp, status FROM bapp WHERE id_bapp = ? AND id_vendor = ?',
      [id, req.user.id]
    );

    console.log('📊 Existing document check:', existing);

    if (existing.length === 0) {
      console.log('❌ Document not found or not owned by user');
      return res.status(404).json({ message: 'Dokumen tidak ditemukan' });
    }

    if (existing[0].status !== 'draft') {
      console.log('❌ Document not in draft status:', existing[0].status);
      return res.status(400).json({ message: 'Hanya dokumen draft yang bisa dihapus' });
    }

    console.log('✅ Document can be deleted, starting transaction');

    await pool.query('START TRANSACTION');

    // Hapus riwayat dokumen terkait untuk menghindari error foreign key
    const [historyDeleteResult] = await pool.query(
      "DELETE FROM document_history WHERE jenis_dokumen = 'bapp' AND id_dokumen = ?",
      [id]
    );
    console.log('📝 History delete result:', historyDeleteResult);


    // Hapus dokumen utama
    const [deleteResult] = await pool.query('DELETE FROM bapp WHERE id_bapp = ?', [id]);
    console.log('🗑️ BAPP delete result:', deleteResult);

    if (deleteResult.affectedRows === 0) {
      // Seharusnya tidak terjadi jika pengecekan di atas berhasil
      throw new Error('Dokumen BAPP tidak ditemukan saat akan dihapus.');
    }

    await pool.query('COMMIT');

    console.log('✅ BAPP deleted successfully');
    console.log('🔚 ========== DELETE BAPP END ==========\n');

    res.json({ message: 'Dokumen BAPP berhasil dihapus' });

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('❌ DELETE BAPP error:', err);
    res.status(500).json({ message: 'Gagal menghapus dokumen BAPP', error: err.message });
  }
});

// PATCH /api/bapp/:id/submit - Ajukan BAPP untuk review
router.patch('/:id/submit', verifyToken, async (req, res) => {
  if (req.user.role !== 'vendor') {
    return res.status(403).json({ message: 'Akses ditolak: hanya vendor' });
  }

  const { id } = req.params;

  try {
    // Check if document exists and belongs to user
    const [existing] = await pool.query(
      'SELECT id_bapp, status, nomor_bapp FROM bapp WHERE id_bapp = ? AND id_vendor = ?',
      [id, req.user.id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ message: 'Dokumen tidak ditemukan' });
    }

    if (existing[0].status !== 'draft') {
      return res.status(400).json({ message: 'Hanya dokumen draft yang bisa diajukan' });
    }

    // Check for attachments
    const [attachments] = await pool.query(
      `SELECT id_lampiran FROM lampiran WHERE jenis_dokumen = 'bapp' AND id_dokumen = ?`,
      [id]
    );

    if (attachments.length === 0) {
      return res.status(400).json({ message: 'Dokumen BAPP harus memiliki setidaknya satu lampiran sebelum diajukan.' });
    }

    await pool.query('START TRANSACTION');

    // Update status to submitted
    await pool.query(
      'UPDATE bapp SET status = ?, updated_at = NOW() WHERE id_bapp = ?',
      ['submitted', id]
    );

    // Log history
    await pool.query(
      `INSERT INTO document_history (
        jenis_dokumen, id_dokumen, actor_role, actor_id, actor_name,
        aktivitas, keterangan, status_sebelum, status_sesudah
      ) VALUES ('bapp', ?, 'vendor', ?, ?, 'submitted', 'Dokumen BAPP diajukan untuk review', 'draft', 'submitted')`,
      [id, req.user.id, req.user.nama_lengkap || req.user.email]
    );

    await pool.query('COMMIT');

    res.json({
      message: 'Dokumen BAPP berhasil diajukan untuk review',
      status: 'submitted'
    });

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('SUBMIT BAPP error:', err);
    res.status(500).json({ message: 'Gagal mengajukan dokumen BAPP', error: err.message });
  }
});

// PUT /api/bapp/:id/approve-direksi - Direksi menyetujui BAPP
router.put('/:id/approve-direksi', verifyToken, async (req, res) => {
  if (req.user.role !== 'direksi') {
    return res.status(403).json({ message: 'Akses ditolak: hanya direksi' });
  }
  const { id } = req.params;
  const { catatan } = req.body;

  try {
    const [existing] = await pool.query('SELECT status FROM bapp WHERE id_bapp = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Dokumen tidak ditemukan' });
    }
    if (!['draft', 'submitted', 'reviewed_pic'].includes(existing[0].status)) {
      return res.status(400).json({ message: `Tidak dapat menyetujui dokumen dengan status ${existing[0].status}` });
    }

    const statusSebelum = existing[0].status; // Capture current status before update

    await pool.query('START TRANSACTION');
    await pool.query('UPDATE bapp SET status = ?, direksi_signed_at = NOW(), updated_at = NOW() WHERE id_bapp = ?', ['approved_direksi', id]);
    await pool.query(
      `INSERT INTO document_history (
        jenis_dokumen, id_dokumen, actor_role, actor_id, actor_name,
        aktivitas, keterangan, status_sebelum, status_sesudah
      ) VALUES ('bapp', ?, 'direksi', ?, ?, 'approved', ?, ?, 'approved_direksi')`,
      [id, req.user.id, req.user.nama_lengkap, catatan || 'Disetujui oleh direksi', statusSebelum]
    );
    await pool.query('COMMIT');
    res.json({ message: 'BAPP berhasil disetujui', status: 'approved_direksi' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('APPROVE BAPP error:', err);
    res.status(500).json({ message: 'Gagal menyetujui BAPP', error: err.message });
  }
});

// PUT /api/bapp/:id/reject - Direksi menolak BAPP
router.put('/:id/reject', verifyToken, async (req, res) => {
  if (req.user.role !== 'direksi') {
    return res.status(403).json({ message: 'Akses ditolak: hanya direksi' });
  }
  const { id } = req.params;
  const { catatan } = req.body;

  if (!catatan) {
    return res.status(400).json({ message: 'Catatan penolakan wajib diisi' });
  }

  try {
    const [existing] = await pool.query('SELECT status FROM bapp WHERE id_bapp = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Dokumen tidak ditemukan' });
    }
    if (!['draft', 'submitted', 'reviewed_pic'].includes(existing[0].status)) {
      return res.status(400).json({ message: `Tidak dapat menolak dokumen dengan status ${existing[0].status}` });
    }

    const statusSebelum = existing[0].status; // Capture current status

    await pool.query('START TRANSACTION');
    await pool.query('UPDATE bapp SET status = ?, updated_at = NOW() WHERE id_bapp = ?', ['rejected', id]);
    await pool.query(
      `INSERT INTO document_history (
        jenis_dokumen, id_dokumen, actor_role, actor_id, actor_name,
        aktivitas, keterangan, status_sebelum, status_sesudah
      ) VALUES ('bapp', ?, 'direksi', ?, ?, 'rejected', ?, ?, 'rejected')`,
      [id, req.user.id, req.user.nama_lengkap, catatan, statusSebelum]
    );
    await pool.query('COMMIT');
    res.json({ message: 'BAPP berhasil ditolak', status: 'rejected' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('REJECT BAPP error:', err);
    res.status(500).json({ message: 'Gagal menolak BAPP', error: err.message });
  }
});

// GET /api/bapp/overview-direksi - Route spesifik untuk overview direksi
router.get('/overview-direksi', verifyToken, async (req, res) => {
  if (req.user.role !== 'direksi') {
    return res.status(403).json({ message: 'Akses ditolak' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT
        b.id_bapp as id,
        b.nomor_bapp,
        b.lokasi_pekerjaan,
        b.status,
        b.updated_at,
        v.nama_lengkap as vendor_name
      FROM bapp b
      LEFT JOIN vendor v ON b.id_vendor = v.id_vendor
      WHERE b.status IN ('approved_direksi', 'rejected')
      ORDER BY b.updated_at DESC`
    );
    
    // Return a structure similar to the paginated one for consistency
    res.json({
      data: rows,
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalItems: rows.length,
        itemsPerPage: rows.length
      }
    });

  } catch (err) {
    console.error('GET OVERVIEW-DIREKSI error:', err);
    res.status(500).json({ message: 'Gagal mengambil data overview', error: err.message });
  }
});

const puppeteer = require('puppeteer');
const path = require('path');

// GET /api/bapp/download/:id - Download BAPP as PDF
router.get('/download/:id', verifyToken, async (req, res) => {
  console.log('\n--- BAPP DOWNLOAD Request ---');
  const { id } = req.params;

  try {
    const [rows] = await pool.query(
      `SELECT
        b.*,
        v.nama_lengkap as vendor_name
      FROM bapp b
      LEFT JOIN vendor v ON b.id_vendor = v.id_vendor
      WHERE b.id_bapp = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Dokumen BAPP tidak ditemukan' });
    }

    const bapp = rows[0];

    // Parse rincian_pekerjaan if it's a string
    let rincianPekerjaan = [];
    if (typeof bapp.rincian_pekerjaan === 'string') {
      try {
        rincianPekerjaan = JSON.parse(bapp.rincian_pekerjaan);
      } catch (e) {
        console.error('Error parsing rincian_pekerjaan JSON for PDF:', e);
      }
    }

    let direksiSignatureHtml = '';
    if (bapp.direksi_signed_at) {
      const direksiSignatureBase64 = await getDireksiSignatureBase64();
      if (direksiSignatureBase64) {
        direksiSignatureHtml = `
          <div style="text-align: right; margin-top: 50px;">
            <p>Disetujui oleh Direksi</p>
            <img src="${direksiSignatureBase64}" alt="Tanda Tangan Direksi" style="width: 150px; height: auto; margin-top: 10px;">
            <p>Tanggal Persetujuan: ${new Date(bapp.direksi_signed_at).toLocaleDateString('id-ID')}</p>
          </div>
        `;
      }
    }

    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true
    });
    const page = await browser.newPage();

    const content = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
            h1 { text-align: center; color: #1e3a8a; border-bottom: 2px solid #1e3a8a; padding-bottom: 10px; }
            .header-info { margin-top: 30px; margin-bottom: 30px; }
            .header-info table { width: 100%; border-collapse: collapse; }
            .header-info td { padding: 5px; vertical-align: top; }
            .header-info .label { font-weight: bold; width: 150px; }
            h2 { color: #1e3a8a; border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-top: 30px; }
            table.rincian { width: 100%; border-collapse: collapse; margin-top: 15px; }
            .rincian th, .rincian td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            .rincian th { background-color: #f2f7ff; }
            .rincian .text-right { text-align: right; }
            .footer { text-align: center; margin-top: 50px; font-size: 0.8em; color: #888; }
            .total-row td { font-weight: bold; background-color: #f2f7ff; }
          </style>
        </head>
        <body>
          <h1>Berita Acara Pemeriksaan Pekerjaan (BAPP)</h1>
          <div class="header-info">
            <table>
              <tr>
                <td class="label">Nomor BAPP</td>
                <td>: ${bapp.nomor_bapp}</td>
              </tr>
              <tr>
                <td class="label">Lokasi Pekerjaan</td>
                <td>: ${bapp.lokasi_pekerjaan}</td>
              </tr>
              <tr>
                <td class="label">Vendor</td>
                <td>: ${bapp.vendor_name}</td>
              </tr>
              <tr>
                <td class="label">No. Kontrak</td>
                <td>: ${bapp.no_kontrak}</td>
              </tr>
               <tr>
                <td class="label">Tanggal Kontrak</td>
                <td>: ${new Date(bapp.tanggal_kontrak).toLocaleDateString('id-ID')}</td>
              </tr>
              <tr>
                <td class="label">Nilai Kontrak</td>
                <td>: ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(bapp.nilai_kontrak)}</td>
              </tr>
            </table>
          </div>
          
          <h2>Rincian Pekerjaan</h2>
          <table class="rincian">
            <thead>
              <tr>
                <th>Item</th>
                <th class="text-right">Jumlah</th>
                <th>Satuan</th>
                <th class="text-right">Harga Satuan</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${rincianPekerjaan.map(item => `
                <tr>
                  <td>${item.item}</td>
                  <td class="text-right">${item.jumlah}</td>
                  <td>${item.satuan}</td>
                  <td class="text-right">${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(item.harga_satuan)}</td>
                  <td class="text-right">${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(item.total)}</td>
                </tr>
              `).join('')}
               <tr class="total-row">
                  <td colspan="4" class="text-right">Total Keseluruhan</td>
                  <td class="text-right">${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(rincianPekerjaan.reduce((sum, item) => sum + item.total, 0))}</td>
                </tr>
            </tbody>
          </table>

          ${direksiSignatureHtml}

          <div class="footer">
            <p>Dokumen ini dibuat secara otomatis oleh sistem.</p>
            <p>Status: ${bapp.status}</p>
          </div>
        </body>
      </html>
    `;

    await page.setContent(content, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    await browser.close();

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
      'Content-Disposition': `attachment; filename="BAPP-${bapp.nomor_bapp}.pdf"`
    });
    res.send(pdfBuffer);

    console.log('--- BAPP DOWNLOAD Success ---');

  } catch (err) {
    console.error('BAPP DOWNLOAD error:', err);
    res.status(500).json({ message: 'Gagal mengunduh BAPP', error: err.message });
  }
});

module.exports = router;

