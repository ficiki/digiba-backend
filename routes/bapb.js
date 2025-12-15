// server/routes/bapb.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');
const Joi = require('joi');
const { fetchDocumentRelations } = require('../utils/documentHelpers'); // Import the helper
const { parseRincianBarangString } = require('../utils/parseRincianBarangString'); // Import the new helper
const { getPicSignatureBase64 } = require('../utils/imageUtils'); // Import image utility
const { sendPushNotification } = require('../utils/push');

const rincianBarangSchema = Joi.array().items(Joi.object({
  nama_barang: Joi.string().required(),
  jumlah: Joi.number().integer().min(1).required(),
  satuan: Joi.string().optional(),
  keterangan: Joi.string().allow('').optional(),
  status_pemeriksaan: Joi.string().valid('sesuai', 'tidak_sesuai', 'belum_diperiksa').default('belum_diperiksa')
})).required();

const bapbSchema = Joi.object({
  nomor_bapb: Joi.string().required(),
  no_kontrak: Joi.string().required(),
  nama_projek: Joi.string().required(),
  nilai_kontrak: Joi.number().positive().required(),
  deskripsi_pekerjaan: Joi.string().required(),
  tanggal_dibuat: Joi.date().iso().required(),
  deadline: Joi.date().iso().optional(),
  tanggal_pengiriman: Joi.date().iso().required(),
  kurir_pengiriman: Joi.string().optional(),
  rincian_barang: Joi.alternatives().try(
    rincianBarangSchema,
    Joi.string().custom((value, helpers) => {
      try {
        const parsed = JSON.parse(value);
        const { error } = rincianBarangSchema.validate(parsed);
        if (error) {
          return helpers.error('any.invalid', { message: error.details[0].message });
        }
        return value;
      } catch (e) {
        return helpers.error('any.invalid', { message: 'Must be a valid JSON string representing an array of items.' });
      }
    }, 'JSON string rincian_barang validation')
  ).required(),
  hasil_pemeriksaan: Joi.string().required(),
  catatan_tambahan: Joi.string().allow('').optional(),
  status: Joi.string().valid('draft', 'submitted', 'reviewed', 'approved').optional(),
  pic_signed_at: Joi.date().iso().optional() // New field for signature timestamp
});

// GET /api/bapb - List BAPB dengan pagination dan filter
router.get('/', verifyToken, async (req, res) => {
  console.log('\n--- BAPB GET / Request ---');
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
    }
    // Added for PIC Gudang to see all BAPB documents if they have 'pic' role
    else if (req.user.role === 'pic') {
        // No explicit whereClause for pic, so it will proceed with general filters.
        // If 'pic' needs to filter by status or search, those will be applied below.
    }


    // Filter status
    if (status) {
      whereClause += ' AND b.status = ?';
      params.push(status);
    }

    // Search filter
    if (search) {
      whereClause += ' AND (b.nomor_bapb LIKE ? OR b.nama_projek LIKE ? OR b.no_kontrak LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    console.log('Constructed WHERE clause:', whereClause);
    console.log('Constructed Params:', params);

    console.log('Final WHERE clause:', whereClause);
    console.log('Final Params (Count Query):', params);
    // Query untuk count total
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM bapb b ${whereClause}`,
      params
    );
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    console.log('Final Params (Data Query):', [...params, parseInt(limit), offset]);
    // Query untuk data
    const [rows] = await pool.query(
      `SELECT
        b.id_bapb as id,
        b.nomor_bapb,
        b.no_kontrak,
        b.nama_projek,
        b.nilai_kontrak,
        b.deskripsi_pekerjaan,
        b.tanggal_dibuat,
        b.deadline,
        b.tanggal_pengiriman,
        b.kurir_pengiriman,
        b.rincian_barang,
        b.hasil_pemeriksaan,
        b.catatan_tambahan,
        b.status,
        b.pic_signed_at,
        b.tanggal_review,
        v.nama_lengkap as vendor_name,
        v.email as vendor_email
      FROM bapb b
      LEFT JOIN vendor v ON b.id_vendor = v.id_vendor
      ${whereClause}
      ORDER BY b.tanggal_dibuat DESC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // Parse rincian_barang JSON
    const data = rows.map(row => ({
      ...row,
      rincian_barang: (() => {
        try {
          return row.rincian_barang ? JSON.parse(row.rincian_barang) : [];
        } catch (e) {
          console.error('Error parsing rincian_barang JSON:', e);
          console.error('Malformed JSON string:', row.rincian_barang);
          // If parsing fails, return the malformed string within an array
          return [row.rincian_barang];
        }
      })()
    }));

    console.log('Total Items:', totalItems);
    console.log('Returned Data Length:', data.length);
    console.log('Returned Document Statuses:', data.map(doc => doc.status));
    console.log('--- BAPB GET / Request End ---\n');

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
    console.error('GET BAPB error:', err);
    res.status(500).json({ message: 'Gagal mengambil data BAPB', error: err.message });
  }
});

// GET /api/bapb/:id - Get BAPB by ID
router.get('/:id', verifyToken, async (req, res) => {
  console.log('\n🔍 ========== GET BAPB BY ID START ==========');
  console.log('👤 User:', req.user.id, req.user.role);
  console.log('📄 Document ID:', req.params.id);

  const { id } = req.params;

  try {
    let query = `
      SELECT
        b.id_bapb as id,
        b.nomor_bapb,
        b.id_vendor,
        b.no_kontrak,
        b.nama_projek as judul,             -- Alias for frontend expectation
        b.nilai_kontrak as nilai,           -- Alias for frontend expectation
        b.deskripsi_pekerjaan,
        b.tanggal_dibuat,
        b.deadline,
        b.tanggal_pengiriman,
        b.kurir_pengiriman,
        b.rincian_barang,
        b.hasil_pemeriksaan,
        b.catatan_tambahan,
        b.status,
        b.created_at,
        b.updated_at,
        b.pic_signed_at,
        b.tanggal_review,
        v.nama_lengkap as vendor_name,
        v.email as vendor_email
      FROM bapb b
      LEFT JOIN vendor v ON b.id_vendor = v.id_vendor
      WHERE b.id_bapb = ? OR b.nomor_bapb = ?
    `;
    const params = [id, id];

    // Vendor can only see their own documents
    if (req.user.role === 'vendor') {
      query += ' AND b.id_vendor = ?';
      params.push(req.user.id);
    }
    
    console.log('SQL Query:', query);
    console.log('Query Params:', params);

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      console.log('❌ Document not found or access denied');
      return res.status(404).json({ message: 'Dokumen BAPB tidak ditemukan atau Anda tidak memiliki akses' });
    }

    const baseDocument = rows[0];

    // Fetch related data using the helper
    const { timeline, lampiran, picTerakhir } = await fetchDocumentRelations('bapb', id);

    const document = {
      ...baseDocument,
      type: 'bapb', // Hardcode type for frontend
      nomorSuratPesanan: baseDocument.no_kontrak, // Add nomorSuratPesanan from no_kontrak
      tanggal_dibuat: baseDocument.tanggal_dibuat, // Ensure date is not messed up by spread
      deadline: baseDocument.deadline, // Ensure date is not messed up by spread
      picTerakhir: picTerakhir, // Add picTerakhir
      timeline: timeline, // Add timeline
      lampiran: lampiran, // Add lampiran
      // nomorSuratPesanan is not available in BAPB, will be undefined/null as expected by frontend
    };

    // Parse rincian_barang JSON if it's a string
    if (typeof document.rincian_barang === 'string') {
        try {
            document.rincian_barang = JSON.parse(document.rincian_barang);
        } catch (e) {
            console.error('Error parsing rincian_barang JSON:', e);
            document.rincian_barang = []; // Default to empty array on parse error
        }
    }


    console.log('✅ Document found:', document.id);
    console.log('🔚 ========== GET BAPB BY ID END ==========');

    res.json(document);

  } catch (err) {
    console.error('❌ GET BAPB BY ID error:', err);
    res.status(500).json({ message: 'Gagal mengambil data BAPB', error: err.message });
  }
});

router.post('/', verifyToken, async (req, res) => {
  if (req.user.role !== 'vendor') {
    return res.status(403).json({ message: 'Akses ditolak: hanya vendor' });
  }

  console.log('\nCREATE BAPB START ==========');
  console.log('User:', req.user.id, req.user.role);
  console.log('Payload:', req.body);

  const { error: validationError } = bapbSchema.validate(req.body);
  if (validationError) {
    console.error('❌ Validation error:', validationError.details);
    return res.status(400).json({ message: 'Input tidak valid', details: validationError.details });
  }

  // === FIX: Normalisasi rincian_barang ===
  let rincianBarang = req.body.rincian_barang;
  
  if (typeof rincianBarang === 'string') {
    try {
      // Try parsing as JSON first
      rincianBarang = JSON.parse(rincianBarang);
    } catch (e) {
      // If JSON parsing fails, try parsing as a plain list string
      console.warn('Attempting to parse rincian_barang as plain list string due to JSON parsing error:', e.message);
      rincianBarang = parseRincianBarangString(req.body.rincian_barang);
    }
  }
  
  if (!Array.isArray(rincianBarang)) {
    console.warn('rincian_barang is not an array after normalization, defaulting to empty array.');
    rincianBarang = [];
  }

  const {
    nomor_bapb,
    no_kontrak,
    nama_projek,
    nilai_kontrak,
    deskripsi_pekerjaan,
    tanggal_dibuat,
    deadline,
    tanggal_pengiriman,
    kurir_pengiriman,
    hasil_pemeriksaan,
    catatan_tambahan,
    status
  } = req.body;

  const id_vendor = req.user.id;
  const nama_vendor = req.user.nama_lengkap || req.user.email;

  try {
    const [existing] = await pool.query('SELECT id_bapb FROM bapb WHERE nomor_bapb = ?', [nomor_bapb]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Nomor BAPB sudah digunakan' });
    }

    await pool.query('START TRANSACTION');

    const [result] = await pool.query(
      `INSERT INTO bapb (
        nomor_bapb, id_vendor, no_kontrak, nama_projek, nilai_kontrak,
        deskripsi_pekerjaan, tanggal_dibuat, deadline, tanggal_pengiriman,
        kurir_pengiriman, rincian_barang, hasil_pemeriksaan, catatan_tambahan, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nomor_bapb,
        id_vendor,
        no_kontrak,
        nama_projek,
        nilai_kontrak,
        deskripsi_pekerjaan,
        tanggal_dibuat,
        deadline || null,
        tanggal_pengiriman,
        kurir_pengiriman || null,
        JSON.stringify(rincianBarang),
        hasil_pemeriksaan,
        catatan_tambahan || null,
        status || 'draft'
      ]
    );

    const docId = result.insertId;

    await pool.query(
      `INSERT INTO document_history (
        jenis_dokumen, id_dokumen, actor_role, actor_id, actor_name,
        aktivitas, keterangan, status_sebelum, status_sesudah
      ) VALUES ('bapb', ?, 'vendor', ?, ?, 'created', 'Dokumen BAPB dibuat', NULL, ?)`,
      [docId, id_vendor, nama_vendor, status || 'draft']
    );

    await pool.query('COMMIT');

    console.log('BAPB BERHASIL dibuat! ID:', docId);
    console.log('CREATE BAPB END ==========\n');

    res.status(201).json({
      message: 'Dokumen BAPB berhasil dibuat',
      id: docId
    });

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('CREATE BAPB GAGAL:', err.stack);
    res.status(500).json({ message: 'Gagal membuat dokumen BAPB', error: err.message });
  }
});

// PUT /api/bapb/:id - Update BAPB
router.put('/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'vendor') {
    return res.status(403).json({ message: 'Akses ditolak: hanya vendor' });
  }

  const { id } = req.params;

  console.log('\nUPDATE BAPB START ==========');
  console.log('User:', req.user.id, req.user.role);
  console.log('Document ID:', id);
  console.log('Payload:', req.body);

  const { error: validationError } = bapbSchema.validate(req.body);
  if (validationError) {
    console.error('❌ Validation error:', validationError.details);
    return res.status(400).json({ message: 'Input tidak valid', details: validationError.details });
  }

  // === FIX: Normalisasi rincian_barang ===
  let rincianBarang = req.body.rincian_barang;
  
  if (typeof rincianBarang === 'string') {
    try {
      // Try parsing as JSON first
      rincianBarang = JSON.parse(rincianBarang);
    } catch (e) {
      // If JSON parsing fails, try parsing as a plain list string
      console.warn('Attempting to parse rincian_barang as plain list string due to JSON parsing error:', e.message);
      rincianBarang = parseRincianBarangString(req.body.rincian_barang);
    }
  }
  
  if (!Array.isArray(rincianBarang)) {
    console.warn('rincian_barang is not an array after normalization, defaulting to empty array.');
    rincianBarang = [];
  }

  const {
    nomor_bapb,
    no_kontrak,
    nama_projek,
    nilai_kontrak,
    deskripsi_pekerjaan,
    tanggal_dibuat,
    deadline,
    tanggal_pengiriman,
    kurir_pengiriman,
    hasil_pemeriksaan,
    catatan_tambahan
  } = req.body;

  try {
    // Check if document exists and belongs to user
    const [existing] = await pool.query(
      'SELECT id_bapb, status FROM bapb WHERE id_bapb = ? AND id_vendor = ?',
      [id, req.user.id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ message: 'Dokumen tidak ditemukan' });
    }

    if (existing[0].status !== 'draft') {
      return res.status(400).json({ message: 'Hanya dokumen draft yang bisa diedit' });
    }

    // Check if nomor_bapb is unique (excluding current document)
    const [duplicate] = await pool.query(
      'SELECT id_bapb FROM bapb WHERE nomor_bapb = ? AND id_bapb != ?',
      [nomor_bapb, id]
    );
    if (duplicate.length > 0) {
      return res.status(409).json({ message: 'Nomor BAPB sudah digunakan' });
    }

    await pool.query('START TRANSACTION');

    // Update document
    const [result] = await pool.query(
      `UPDATE bapb SET
        nomor_bapb = ?, no_kontrak = ?, nama_projek = ?, nilai_kontrak = ?,
        deskripsi_pekerjaan = ?, tanggal_dibuat = ?, deadline = ?, tanggal_pengiriman = ?,
        kurir_pengiriman = ?, rincian_barang = ?, hasil_pemeriksaan = ?, catatan_tambahan = ?,
        updated_at = NOW()
      WHERE id_bapb = ?`,
      [
        nomor_bapb,
        no_kontrak,
        nama_projek,
        nilai_kontrak,
        deskripsi_pekerjaan,
        tanggal_dibuat,
        deadline || null,
        tanggal_pengiriman,
        kurir_pengiriman || null,
        JSON.stringify(rincianBarang),
        hasil_pemeriksaan,
        catatan_tambahan || null,
        id
      ]
    );

    // Log history
    await pool.query(
      `INSERT INTO document_history (
        jenis_dokumen, id_dokumen, actor_role, actor_id, actor_name,
        aktivitas, keterangan, status_sebelum, status_sesudah
      ) VALUES ('bapb', ?, 'vendor', ?, ?, 'updated', 'Dokumen BAPB diperbarui', 'draft', 'draft')`,
      [id, req.user.id, req.user.nama_lengkap || req.user.email]
    );

    await pool.query('COMMIT');

    console.log('BAPB BERHASIL diperbarui! ID:', id);
    console.log('UPDATE BAPB END ==========\n');

    res.json({
      message: 'Dokumen BAPB berhasil diperbarui',
      id: id
    });

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('UPDATE BAPB GAGAL:', err.stack);
    res.status(500).json({ message: 'Gagal memperbarui dokumen BAPB', error: err.message });
  }
});

// DELETE /api/bapb/:id - Hapus BAPB
router.delete('/:id', verifyToken, async (req, res) => {
  console.log('\n🗑️ ========== DELETE BAPB START ==========');
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
      'SELECT id_bapb, status FROM bapb WHERE id_bapb = ? AND id_vendor = ?',
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
      "DELETE FROM document_history WHERE jenis_dokumen = 'bapb' AND id_dokumen = ?",
      [id]
    );
    console.log('📝 History delete result:', historyDeleteResult);


    // Hapus dokumen utama
    const [deleteResult] = await pool.query('DELETE FROM bapb WHERE id_bapb = ?', [id]);
    console.log('🗑️ BAPB delete result:', deleteResult);

    if (deleteResult.affectedRows === 0) {
      // Seharusnya tidak terjadi jika pengecekan di atas berhasil
      throw new Error('Dokumen BAPB tidak ditemukan saat akan dihapus.');
    }

    await pool.query('COMMIT');

    console.log('✅ BAPB deleted successfully');
    console.log('🔚 ========== DELETE BAPB END ==========\n');

    res.json({ message: 'Dokumen BAPB berhasil dihapus' });

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('❌ DELETE BAPB error:', err);
    console.error('❌ Error stack:', err.stack);
    console.error('❌ Error code:', err.code);
    console.error('❌ Error errno:', err.errno);
    res.status(500).json({
      message: 'Gagal menghapus dokumen BAPB',
      error: err.message,
      code: err.code,
      errno: err.errno
    });
  }
});

// PATCH /api/bapb/:id/submit - Ajukan BAPB untuk review
router.patch('/:id/submit', verifyToken, async (req, res) => {
  if (req.user.role !== 'vendor') {
    return res.status(403).json({ message: 'Akses ditolak: hanya vendor' });
  }

  const { id } = req.params;

  try {
    // Check if document exists and belongs to user
    const [existing] = await pool.query(
      'SELECT id_bapb, status, nomor_bapb, id_vendor FROM bapb WHERE id_bapb = ? AND id_vendor = ?',
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
      `SELECT id_lampiran FROM lampiran WHERE jenis_dokumen = 'bapb' AND id_dokumen = ?`,
      [id]
    );

    if (attachments.length === 0) {
      return res.status(400).json({ message: 'Dokumen BAPB harus memiliki setidaknya satu lampiran sebelum diajukan.' });
    }

    await pool.query('START TRANSACTION');

    // Update status to submitted
    await pool.query(
      'UPDATE bapb SET status = ?, updated_at = NOW() WHERE id_bapb = ?',
      ['submitted', id]
    );

    // Log history
    await pool.query(
      `INSERT INTO document_history (
        jenis_dokumen, id_dokumen, actor_role, actor_id, actor_name,
        aktivitas, keterangan, status_sebelum, status_sesudah
      ) VALUES ('bapb', ?, 'vendor', ?, ?, 'submitted', 'Dokumen BAPB diajukan untuk review', 'draft', 'submitted')`,
      [id, req.user.id, req.user.nama_lengkap || req.user.email]
    );

    // NOTIFICATION LOGIC
    // 1. Get all PIC users
    const [picUsers] = await pool.query("SELECT id_user FROM users WHERE role = 'pic'");
    
    // 2. Create a notification for each PIC user
    if (picUsers && picUsers.length > 0) {
      const title = `BAPB ${existing[0].nomor_bapb} Perlu Dicek`;
      const picNotificationPromises = picUsers.map(user => {
        // Create in-app notification
        pool.query(
          `INSERT INTO notifications (user_id, title, document_id, document_type)
           VALUES (?, ?, ?, 'bapb')`,
          [user.id_user, title, id]
        );
        // Send push notification to each PIC
        sendPushNotification(user.id_user, {
          title: title,
          body: `Dokumen BAPB baru dari vendor ${req.user.nama_lengkap || req.user.email} telah diajukan dan perlu dicek.`,
          data: { url: `/pic-gudang/pengecekan-barang/${id}` }
        });
      });

      await Promise.all(picNotificationPromises);
      console.log(`✅ Created and sent push notifications to ${picUsers.length} PIC users.`);

      // Send confirmation push notification to the vendor
      sendPushNotification(req.user.id, {
        title: 'BAPB Berhasil Diajukan',
        body: `Dokumen BAPB ${existing[0].nomor_bapb} telah berhasil diajukan untuk proses review.`,
        data: { url: `/vendor/dokumen-saya/bapb/${id}` }
      });
    }

    await pool.query('COMMIT');

    res.json({
      message: 'Dokumen BAPB berhasil diajukan untuk review',
      status: 'submitted'
    });

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('SUBMIT BAPB error:', err);
    res.status(500).json({ message: 'Gagal mengajukan dokumen BAPB', error: err.message });
  }
});


// PUT /api/bapb/:id/review - PIC melakukan review barang
router.put('/:id/review', verifyToken, async (req, res) => {
    // 1. Authorization: Hanya PIC
    if (req.user.role !== 'pic') {
        return res.status(403).json({ message: 'Akses ditolak: Hanya PIC Gudang yang dapat melakukan review.' });
    }

    const { id } = req.params;
    const { rincian_barang_review, catatan_pic } = req.body;

    // 2. Validation
    if (!rincian_barang_review || !Array.isArray(rincian_barang_review)) {
        return res.status(400).json({ message: 'Data review rincian barang tidak valid.' });
    }

    try {
        await pool.query('START TRANSACTION');

        // 3. Find document and check status
        const [existing] = await pool.query(
            'SELECT status, id_vendor, nomor_bapb FROM bapb WHERE id_bapb = ?',
            [id]
        );

        if (existing.length === 0) {
            await pool.query('ROLLBACK');
            return res.status(404).json({ message: 'Dokumen BAPB tidak ditemukan.' });
        }
        if (existing[0].status !== 'submitted') {
            await pool.query('ROLLBACK');
            return res.status(400).json({ message: `Hanya dokumen dengan status 'submitted' yang bisa direview. Status saat ini: ${existing[0].status}` });
        }

        // 4. Update document with fallback for missing 'catatan_pic' column
        try {
            await pool.query(
                `UPDATE bapb SET 
                    status = 'reviewed', 
                    rincian_barang = ?,
                    catatan_pic = ?,
                    tanggal_review = NOW(),
                    updated_at = NOW()
                 WHERE id_bapb = ?`,
                [JSON.stringify(rincian_barang_review), catatan_pic || null, id]
            );
        } catch (updateErr) {
            if (updateErr.code === 'ER_BAD_FIELD_ERROR' && updateErr.sqlMessage.includes('catatan_pic')) {
                console.warn("⚠️ 'catatan_pic' column not found in 'bapb'. Updating without it.");
                await pool.query(
                    `UPDATE bapb SET 
                        status = 'reviewed', 
                        rincian_barang = ?,
                        tanggal_review = NOW(),
                        updated_at = NOW()
                     WHERE id_bapb = ?`,
                    [JSON.stringify(rincian_barang_review), id]
                );
            } else {
                throw updateErr; // Re-throw other errors
            }
        }

        // 5. Log history
        await pool.query(
            `INSERT INTO document_history (
                jenis_dokumen, id_dokumen, actor_role, actor_id, actor_name,
                aktivitas, keterangan, status_sebelum, status_sesudah
            ) VALUES ('bapb', ?, ?, ?, ?, 'reviewed', ?, 'submitted', 'reviewed')`,
            [id, req.user.role, req.user.id, req.user.nama_lengkap || req.user.email, 'Barang telah dicek oleh PIC Gudang.']
        );
        
        // 6. Create notification for Vendor
        const vendorId = existing[0].id_vendor;
        const title = `BAPB ${existing[0].nomor_bapb} Telah Dicek`;
        
        await pool.query(
          `INSERT INTO notifications (user_id, title, document_id, document_type)
           VALUES (?, ?, ?, 'bapb')`,
          [vendorId, title, id]
        );

        // Send push notification
        sendPushNotification(vendorId, {
          title: title,
          body: `Dokumen BAPB ${existing[0].nomor_bapb} telah selesai dicek oleh PIC Gudang.`,
          data: { url: `/vendor/dokumen-saya/bapb/${id}` }
        });

        await pool.query('COMMIT');

        res.json({
            message: 'Pengecekan barang berhasil disimpan. Dokumen dipindahkan ke tahap persetujuan.',
            status: 'reviewed'
        });

    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('BAPB REVIEW error:', err);
        res.status(500).json({ message: 'Gagal menyimpan hasil pengecekan.', error: err.message });
    }
});

// PUT /api/bapb/:id/approve - PIC melakukan persetujuan BAPB
router.put('/:id/approve', verifyToken, async (req, res) => {
    if (req.user.role !== 'pic') {
        return res.status(403).json({ message: 'Akses ditolak: Hanya PIC Gudang yang dapat menyetujui BAPB.' });
    }

    const { id } = req.params;
    const { approval_note } = req.body;

    try {
        await pool.query('START TRANSACTION');

        const [existing] = await pool.query(
            'SELECT status, id_vendor, nomor_bapb FROM bapb WHERE id_bapb = ?',
            [id]
        );

        if (existing.length === 0) {
            await pool.query('ROLLBACK');
            return res.status(404).json({ message: 'Dokumen BAPB tidak ditemukan.' });
        }
        if (existing[0].status !== 'reviewed') {
            await pool.query('ROLLBACK');
            return res.status(400).json({ message: `Hanya dokumen dengan status 'reviewed' yang bisa disetujui. Status saat ini: ${existing[0].status}` });
        }

        try {
                        await pool.query(
                            `UPDATE bapb SET
                                status = 'approved',
                                catatan_persetujuan = ?,
                                tanggal_persetujuan = NOW(),
                                pic_signed_at = NOW(),
                                updated_at = NOW()
                             WHERE id_bapb = ?`,
                            [approval_note || null, id]
                        );        } catch (updateErr) {
            if (updateErr.code === 'ER_BAD_FIELD_ERROR') {
                console.warn(`⚠️ A column is missing in 'bapb' during approval (e.g., 'catatan_persetujuan' or 'tanggal_persetujuan'). Updating status only.`);
                await pool.query(
                    `UPDATE bapb SET 
                        status = 'approved',
                        updated_at = NOW()
                     WHERE id_bapb = ?`,
                    [id]
                );
            } else {
                throw updateErr; // Re-throw other unexpected errors
            }
        }

        await pool.query(
            `INSERT INTO document_history (
                jenis_dokumen, id_dokumen, actor_role, actor_id, actor_name,
                aktivitas, keterangan, status_sebelum, status_sesudah
            ) VALUES ('bapb', ?, ?, ?, ?, 'approved', ?, 'reviewed', 'approved')`,
            [id, req.user.role, req.user.id, req.user.nama_lengkap || req.user.email, 'Dokumen BAPB telah disetujui oleh PIC Gudang.']
        );
        
        // NOTIFICATION LOGIC FOR VENDOR (existing)
        const vendorId = existing[0].id_vendor;
        const vendorNotificationTitle = `BAPB ${existing[0].nomor_bapb} Telah Disetujui`;
        await pool.query(
          `INSERT INTO notifications (user_id, title, document_id, document_type)
           VALUES (?, ?, ?, 'bapb')`,
          [vendorId, vendorNotificationTitle, id]
        );

        // Send push notification to Vendor
        sendPushNotification(vendorId, {
          title: vendorNotificationTitle,
          body: `Selamat! Dokumen BAPB ${existing[0].nomor_bapb} telah disetujui oleh PIC Gudang.`,
          data: { url: `/vendor/dokumen-saya/bapb/${id}` }
        });

        // NOTIFICATION LOGIC FOR PIC (new)
        const picNotificationTitle = `Anda telah menyetujui BAPB ${existing[0].nomor_bapb}`;
        await pool.query(
            `INSERT INTO notifications (user_id, title, description, notification_type, document_id, document_type)
            VALUES (?, ?, ?, ?, ?, 'bapb')`,
            [req.user.id, picNotificationTitle, `BAPB ${existing[0].nomor_bapb} berhasil disetujui.`, 'success', id]
        );

        await pool.query('COMMIT');

        res.json({
            message: 'Dokumen BAPB berhasil disetujui.',
            status: 'approved'
        });

    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('BAPB APPROVE error:', err);
        res.status(500).json({ message: 'Gagal menyetujui dokumen BAPB.', error: err.message });
    }
});

// PUT /api/bapb/:id/reject - PIC melakukan penolakan BAPB
router.put('/:id/reject', verifyToken, async (req, res) => {
    if (req.user.role !== 'pic') {
        return res.status(403).json({ message: 'Akses ditolak: Hanya PIC Gudang yang dapat menolak BAPB.' });
    }

    const { id } = req.params;
    const { rejection_reason } = req.body;

    if (!rejection_reason || rejection_reason.trim() === '') {
        return res.status(400).json({ message: 'Alasan penolakan harus diberikan.' });
    }

    try {
        await pool.query('START TRANSACTION');

        const [existing] = await pool.query(
            'SELECT status, id_vendor, nomor_bapb FROM bapb WHERE id_bapb = ?',
            [id]
        );

        if (existing.length === 0) {
            await pool.query('ROLLBACK');
            return res.status(404).json({ message: 'Dokumen BAPB tidak ditemukan.' });
        }
        if (existing[0].status !== 'reviewed') {
            await pool.query('ROLLBACK');
            return res.status(400).json({ message: `Hanya dokumen dengan status 'reviewed' yang bisa ditolak. Status saat ini: ${existing[0].status}` });
        }

        try {
            await pool.query(
                `UPDATE bapb SET 
                    status = 'rejected', 
                    alasan_penolakan = ?,
                    updated_at = NOW()
                 WHERE id_bapb = ?`,
                [rejection_reason, id]
            );
        } catch (updateErr) {
            if (updateErr.code === 'ER_BAD_FIELD_ERROR' && updateErr.sqlMessage.includes('alasan_penolakan')) {
                console.warn("⚠️ 'alasan_penolakan' column not found in 'bapb'. Updating status to 'rejected' without the reason.");
                await pool.query(
                    `UPDATE bapb SET 
                        status = 'rejected', 
                        updated_at = NOW()
                     WHERE id_bapb = ?`,
                    [id]
                );
            } else {
                throw updateErr; // Re-throw other unexpected errors
            }
        }

        await pool.query(
            `INSERT INTO document_history (
                jenis_dokumen, id_dokumen, actor_role, actor_id, actor_name,
                aktivitas, keterangan, status_sebelum, status_sesudah
            ) VALUES ('bapb', ?, ?, ?, ?, 'rejected', ?, 'reviewed', 'rejected')`,
            [id, req.user.role, req.user.id, req.user.nama_lengkap || req.user.email, `Dokumen BAPB ditolak oleh PIC Gudang dengan alasan: ${rejection_reason}`]
        );
        
        // NOTIFICATION LOGIC FOR VENDOR (existing)
        const vendorId = existing[0].id_vendor;
        const vendorNotificationTitle = `BAPB ${existing[0].nomor_bapb} Ditolak`;
        await pool.query(
          `INSERT INTO notifications (user_id, title, document_id, document_type)
           VALUES (?, ?, ?, 'bapb')`,
          [vendorId, vendorNotificationTitle, id]
        );

        // Send push notification to Vendor
        sendPushNotification(vendorId, {
          title: vendorNotificationTitle,
          body: `Dokumen BAPB ${existing[0].nomor_bapb} ditolak dengan alasan: ${rejection_reason}.`,
          data: { url: `/vendor/dokumen-saya/bapb/${id}` }
        });

        // NOTIFICATION LOGIC FOR PIC (new)
        const picNotificationTitle = `Anda telah menolak BAPB ${existing[0].nomor_bapb}`;
        await pool.query(
            `INSERT INTO notifications (user_id, title, description, notification_type, document_id, document_type)
            VALUES (?, ?, ?, ?, ?, 'bapb')`,
            [req.user.id, picNotificationTitle, `BAPB ${existing[0].nomor_bapb} telah ditolak dengan alasan: ${rejection_reason}.`, 'error', id]
        );

        await pool.query('COMMIT');

        res.json({
            message: 'Dokumen BAPB berhasil ditolak.',
            status: 'rejected'
        });

    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('BAPB REJECT error:', err);
        res.status(500).json({ message: 'Gagal menolak dokumen BAPB.', error: err.message });
    }
});

const puppeteer = require('puppeteer');
const path = require('path');

// GET /api/bapb/download/:id - Download BAPB as PDF
router.get('/download/:id', verifyToken, async (req, res) => {
  console.log('\n--- BAPB DOWNLOAD Request ---');
  const { id } = req.params;

  try {
    const [rows] = await pool.query(
      `SELECT
        b.*,
        v.nama_lengkap as vendor_name,
        b.pic_signed_at
      FROM bapb b
      LEFT JOIN vendor v ON b.id_vendor = v.id_vendor
      WHERE b.id_bapb = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Dokumen BAPB tidak ditemukan' });
    }

    const bapb = rows[0];

    // Parse rincian_barang if it's a string
    let rincianBarang = [];
    if (typeof bapb.rincian_barang === 'string') {
      try {
        rincianBarang = JSON.parse(bapb.rincian_barang);
      } catch (e) {
        console.error('Error parsing rincian_barang JSON for PDF:', e);
      }
    }

    let picSignatureHtml = '';
    if (bapb.pic_signed_at) {
      const picSignatureBase64 = await getPicSignatureBase64();
      if (picSignatureBase64) {
        picSignatureHtml = `
          <div style="text-align: right; margin-top: 50px;">
            <p>Disetujui oleh PIC Gudang</p>
            <img src="${picSignatureBase64}" alt="Tanda Tangan PIC" style="width: 150px; height: auto; margin-top: 10px;">
            <p>Tanggal Persetujuan: ${new Date(bapb.pic_signed_at).toLocaleDateString('id-ID')}</p>
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
            body { font-family: Arial, sans-serif; margin: 40px; }
            h1 { text-align: center; color: #333; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
            .header { margin-bottom: 30px; }
            .footer { text-align: center; margin-top: 40px; font-size: 0.8em; color: #888; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Berita Acara Pemeriksaan Barang (BAPB)</h1>
          </div>
          <p><strong>Nomor BAPB:</strong> ${bapb.nomor_bapb}</p>
          <p><strong>Nama Projek:</strong> ${bapb.nama_projek}</p>
          <p><strong>Vendor:</strong> ${bapb.vendor_name}</p>
          <p><strong>Tanggal Dibuat:</strong> ${new Date(bapb.tanggal_dibuat).toLocaleDateString('id-ID')}</p>
          
          <h2>Rincian Barang</h2>
          <table>
            <thead>
              <tr>
                <th>Nama Barang</th>
                <th>Jumlah</th>
                <th>Satuan</th>
                <th>Keterangan</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rincianBarang.map(item => `
                <tr>
                  <td>${item.nama_barang}</td>
                  <td>${item.jumlah}</td>
                  <td>${item.satuan}</td>
                  <td>${item.keterangan || ''}</td>
                  <td>${item.status_pemeriksaan}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          ${picSignatureHtml}

          <div class="footer">
            <p>Dokumen ini dibuat secara otomatis oleh sistem.</p>
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
      'Content-Disposition': `attachment; filename="BAPB-${bapb.nomor_bapb}.pdf"`
    });
    res.send(pdfBuffer);

    console.log('--- BAPB DOWNLOAD Success ---');

  } catch (err) {
    console.error('BAPB DOWNLOAD error:', err);
    res.status(500).json({ message: 'Gagal mengunduh BAPB', error: err.message });
  }
});

module.exports = router;
