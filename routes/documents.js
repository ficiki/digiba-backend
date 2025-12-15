const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');

// GET /api/documents/combined - Combined BAPB + BAPP documents
router.get('/combined', verifyToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status = '',
      search = ''
    } = req.query;

    const offset = (page - 1) * limit;
    let whereClause = '';
    let params = [];

    // Filter berdasarkan role user
    if (req.user.role === 'vendor') {
      whereClause += 'WHERE b.id_vendor = ?';
      params.push(req.user.id);
    }

    // Filter status
    if (status) {
      whereClause += whereClause ? ' AND' : 'WHERE';
      whereClause += ' b.status = ?';
      params.push(status);
    }

    // Search filter
    if (search) {
      whereClause += whereClause ? ' AND' : 'WHERE';
      whereClause += ' (b.nomor_bapb LIKE ? OR b.nama_projek LIKE ? OR b.no_kontrak LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Query untuk count total BAPB
    const [bapbCountResult] = await pool.query(
      `SELECT COUNT(*) as total FROM bapb b ${whereClause}`,
      params
    );
    const bapbTotal = bapbCountResult[0].total;

    // Query untuk count total BAPP
    let bappWhereClause = whereClause.replace(/b\./g, 'bapp.');
    const [bappCountResult] = await pool.query(
      `SELECT COUNT(*) as total FROM bapp bapp ${bappWhereClause}`,
      params
    );
    const bappTotal = bappCountResult[0].total;



    // Query untuk data BAPB
    const [bapbRows] = await pool.query(
      `SELECT
        b.id_bapb as id,
        'BAPB' as jenis,
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
        b.created_at,
        v.nama_lengkap as vendor_nama,
        v.nama_perusahaan
      FROM bapb b
      LEFT JOIN vendor v ON b.id_vendor = v.id_vendor
      ${whereClause}
      ORDER BY b.tanggal_dibuat DESC`,
      params
    );

    // Query untuk data BAPP
    const [bappRows] = await pool.query(
      `SELECT
        bapp.id_bapp as id,
        'BAPP' as jenis,
        bapp.nomor_bapp,
        bapp.no_kontrak,
        bapp.lokasi_pekerjaan as nama_projek,
        bapp.nilai_kontrak,
        bapp.rincian_pekerjaan as deskripsi_pekerjaan,
        bapp.tanggal_kontrak as tanggal_dibuat,
        NULL as deadline,
        NULL as tanggal_pengiriman,
        NULL as kurir_pengiriman,
        bapp.rincian_pekerjaan as rincian_barang,
        bapp.hasil_pemeriksaan,
        bapp.keterangan as catatan_tambahan,
        bapp.status,
        bapp.created_at,
        v.nama_lengkap as vendor_nama,
        v.nama_perusahaan
      FROM bapp bapp
      LEFT JOIN vendor v ON bapp.id_vendor = v.id_vendor
      ${bappWhereClause}
      ORDER BY bapp.created_at DESC`,
      params
    );

    // Gabungkan dan parse data
    let combinedData = [
      ...bapbRows.map(row => ({
        ...row,
        rincian_barang: row.rincian_barang ? JSON.parse(row.rincian_barang) : []
      })),
      ...bappRows.map(row => ({
        ...row,
        rincian_barang: row.rincian_barang ? JSON.parse(row.rincian_barang) : []
      }))
    ];

    // Sort combined data by created_at DESC
    combinedData.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const totalItems = combinedData.length;
    const totalPages = Math.ceil(totalItems / limit);

    // Apply pagination to combined result
    const startIndex = offset;
    const endIndex = startIndex + parseInt(limit);
    const paginatedData = combinedData.slice(startIndex, endIndex);

    res.json({
      data: paginatedData,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems,
        itemsPerPage: parseInt(limit)
      }
    });

  } catch (err) {
    console.error('GET COMBINED DOCUMENTS error:', err);
    res.status(500).json({ message: 'Gagal mengambil data dokumen gabungan', error: err.message });
  }
});

router.get('/history', verifyToken, async (req, res) => {
  const { jenis_dokumen, id_dokumen } = req.query;

  try {
    let query = 'SELECT * FROM document_history WHERE 1=1';
    const params = [];

    if (jenis_dokumen) {
      query += ' AND jenis_dokumen = ?';
      params.push(jenis_dokumen);
    }

    if (id_dokumen) {
      query += ' AND id_dokumen = ?';
      params.push(id_dokumen);
    }

    query += ' ORDER BY created_at DESC LIMIT 100';

    const [rows] = await pool.query(
      `SELECT
         id_history,
         jenis_dokumen,
         id_dokumen,
         actor_role,
         actor_name,
         keterangan,
         status_sebelum,
         status_sesudah,
         created_at
       FROM document_history
       WHERE (? IS NULL OR jenis_dokumen = ?)
         AND (? IS NULL OR id_dokumen = ?)
       ORDER BY created_at DESC
       LIMIT 100`,
      [jenis_dokumen, jenis_dokumen, id_dokumen, id_dokumen]
    );

    res.json(rows);
  } catch (err) {
    console.error('Get history error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.get('/stats', verifyToken, async (req, res) => {
  const { role, id } = req.user;

  try {
    let totalQuery;
    let totalParams = [];

    if (role === 'pic') {
      // For PIC role, primarily show stats for BAPB
      totalQuery = `
        SELECT COUNT(*) as total, status
        FROM bapb
        WHERE 1=1
      `;
      // If PIC should only see specific BAPB (e.g., related to their assigned tasks),
      // further WHERE clauses would be needed here. For now, assuming all BAPB for PIC stats.
    } else if (role === 'direksi') {
      // For Direksi role, primarily show stats for BAPP
      totalQuery = `
        SELECT COUNT(*) as total, status
        FROM bapp
        WHERE 1=1
      `;
    }
    else {
      // For other roles (e.g., vendor), combine BAPB and BAPP
      totalQuery = `
        SELECT COUNT(*) as total, status
        FROM (
          SELECT id_bapb as id, status, id_vendor FROM bapb
          UNION ALL
          SELECT id_bapp as id, status, id_vendor FROM bapp
        ) AS combined_docs
        WHERE 1=1
      `;
      if (role === 'vendor') {
        totalQuery += ' AND id_vendor = ?';
        totalParams.push(id);
      }
    }
    
    totalQuery += ' GROUP BY status WITH ROLLUP'; // Use WITH ROLLUP to get total count easily

    const [statsResult] = await pool.query(totalQuery, totalParams);

    const documentStats = {
      total: 0,
      draft: 0,
      submitted: 0, // General submitted count (BAPB or BAPP)
      approved: 0, // General approved count (BAPB or BAPP)
      reviewed: 0, // General reviewed count (BAPB or BAPP)
      rejected: 0, // General rejected count (BAPB or BAPP)
      
      // Specific BAPP stats for Direksi dashboard
      bappPending: 0, // Corresponds to 'submitted' for BAPP
      bappApproved: 0, // Corresponds to 'approved_direksi' for BAPP
      bappRejected: 0, // Corresponds to 'rejected' for BAPP
      averageTime: 'N/A' // Placeholder
    };

    statsResult.forEach(row => {
      if (row.status === null) { // This is the total count from WITH ROLLUP
        documentStats.total = row.total;
      } else {
        switch (row.status) {
          case 'draft':
            documentStats.draft += row.total;
            break;
          case 'submitted':
            documentStats.submitted += row.total;
            if (role === 'direksi') { // For direksi, 'submitted' BAPP documents are 'pending' their approval
              documentStats.bappPending += row.total;
            }
            break;
          case 'reviewed': // BAPB
          case 'reviewed_pic': // BAPP
            documentStats.reviewed += row.total;
            documentStats.submitted += row.total; // Also count as submitted for overall pending
            break;
          case 'approved': // BAPB
            documentStats.approved += row.total;
            break;
          case 'approved_direksi': // BAPP
            documentStats.approved += row.total; // General approved count
            if (role === 'direksi') {
              documentStats.bappApproved += row.total;
            }
            break;
          case 'rejected':
            documentStats.rejected += row.total;
            if (role === 'direksi') {
              documentStats.bappRejected += row.total;
            }
            break;
          default:
            break;
        }
      }
    });

    // For the frontend, 'Menunggu Review' should combine 'submitted' and 'reviewed'/'reviewed_pic'
    // 'Disetujui' should combine 'approved' and 'approved_direksi'
    // 'Draft' is just 'draft'

    res.json({
      total: documentStats.total,
      draft: documentStats.draft,
      submitted: documentStats.submitted + documentStats.reviewed, // Combine submitted and reviewed statuses for 'Menunggu Review'
      approved: documentStats.approved,
      rejected: documentStats.rejected,
      // Specific stats for Direksi Dashboard
      pendingBapp: documentStats.bappPending,
      approvedBapp: documentStats.bappApproved,
      rejectedBapp: documentStats.bappRejected,
      averageTime: documentStats.averageTime
    });
  } catch (err) {
    console.error('Get stats error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});


const puppeteer = require('puppeteer'); // Assuming puppeteer is installed

// Helper function to format currency
const formatCurrency = (amount) => {
  if (isNaN(amount) || amount === null) return 'Rp 0';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(amount);
};

// Helper function to format date
const formatDate = (dateString) => {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

// Function to generate HTML for PDF from document data
const generatePdfHtml = (documentData, type) => {
  if (!documentData) return '<h1>Dokumen tidak ditemukan</h1>';

  const isBAPB = type === 'bapb';
  const rincianItems = isBAPB ? documentData.rincian_barang : documentData.rincian_pekerjaan;
  const descriptionText = isBAPB ? documentData.deskripsi_pekerjaan : documentData.hasil_pemeriksaan;
  const documentNumber = documentData.nomor_bapp || documentData.nomor_bapb; // Use the actual document number
  const projectName = isBAPB ? documentData.nama_projek : documentData.lokasi_pekerjaan;
  const contractValue = formatCurrency(documentData.nilai_kontrak);

  const rincianHtml = rincianItems && rincianItems.length > 0 ? `
    <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
      <thead>
        <tr style="background-color: #f2f2f2;">
          <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Item</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Jumlah</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Satuan</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">Harga Satuan</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${rincianItems.map(item => `
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px;">${item.item || item.nama_barang}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${item.jumlah}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${item.satuan}</td>
            <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${formatCurrency(item.harga_satuan)}</td>
            <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${formatCurrency(item.total)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '<p>Tidak ada rincian yang tersedia.</p>';


  return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>${isBAPB ? 'Berita Acara Pemeriksaan Barang' : 'Berita Acara Pemeriksaan Pekerjaan'} - ${documentNumber}</title>
        <style>
            body { font-family: 'Arial', sans-serif; margin: 40px; color: #333; }
            .container { max-width: 800px; margin: auto; }
            h1, h2, h3 { color: #222; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 1px solid #eee; padding-bottom: 20px; }
            .header h1 { font-size: 24px; margin: 0; }
            .header p { font-size: 14px; color: #666; margin-top: 5px; }
            .section { margin-bottom: 20px; }
            .section-title { font-size: 18px; font-weight: bold; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px; }
            .info-item label { font-weight: bold; display: block; margin-bottom: 3px; }
            .info-item p { margin: 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 13px;}
            th { background-color: #f2f2f2; }
            .footer { margin-top: 50px; text-align: center; font-size: 12px; color: #888; }
            .signature-section { margin-top: 40px; display: flex; justify-content: space-around; text-align: center; }
            .signature-block { width: 45%; }
            .signature-block p:first-child { font-weight: bold; margin-bottom: 60px; }
            .signature-block p:last-child { margin-top: 5px; font-size: 13px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>${isBAPB ? 'BERITA ACARA PEMERIKSAAN BARANG' : 'BERITA ACARA PEMERIKSAAN PEKERJAAN'}</h1>
                <p>Nomor: ${documentNumber}</p>
            </div>

            <div class="section">
                <h2 class="section-title">Informasi Dokumen</h2>
                <div class="info-grid">
                    <div class="info-item">
                        <label>Judul ${isBAPB ? 'Projek' : 'Pekerjaan'}:</label>
                        <p>${projectName}</p>
                    </div>
                    <div class="info-item">
                        <label>Nomor Kontrak:</label>
                        <p>${documentData.no_kontrak}</p>
                    </div>
                    <div class="info-item">
                        <label>Nilai Kontrak:</label>
                        <p>${contractValue}</p>
                    </div>
                    <div class="info-item">
                        <label>Tanggal Dibuat:</label>
                        <p>${formatDate(documentData.tanggal_dibuat || documentData.tanggal_kontrak)}</p>
                    </div>
                    <div class="info-item">
                        <label>Lokasi ${isBAPB ? 'Pengiriman' : 'Pekerjaan'}:</label>
                        <p>${documentData.lokasi_pekerjaan || 'N/A'}</p>
                    </div>
                     <div class="info-item">
                        <label>Vendor:</label>
                        <p>${documentData.vendor_name || 'N/A'}</p>
                    </div>
                </div>
            </div>

            <div class="section">
                <h2 class="section-title">Deskripsi ${isBAPB ? 'Pemeriksaan Barang' : 'Pemeriksaan Pekerjaan'}</h2>
                <p>${descriptionText || 'Tidak ada deskripsi.'}</p>
            </div>

            <div class="section">
                <h2 class="section-title">Rincian ${isBAPB ? 'Barang' : 'Pekerjaan'}</h2>
                ${rincianHtml}
            </div>

            <div class="signature-section">
                <div class="signature-block">
                    <p>Vendor</p>
                    <p>(___________________________)</p>
                    <p>Nama & Cap Perusahaan</p>
                </div>
                <div class="signature-block">
                    <p>${isBAPB ? 'PIC Gudang' : 'Direksi Pekerjaan'}</p>
                    <p>(___________________________)</p>
                    <p>Nama & Tanda Tangan</p>
                </div>
            </div>
            
            <div class="footer">
                <p>Dokumen ini dibuat secara otomatis oleh sistem.</p>
                <p>Dicetak pada: ${formatDate(new Date())}</p>
            </div>
        </div>
    </body>
    </html>
  `;
};

// New route for PDF generation
router.get('/:type/:id/pdf', verifyToken, async (req, res) => {
  const { type, id } = req.params;

  try {
    let documentData;
    let query;
    let params = [id];

    if (type === 'bapb') {
      query = `
        SELECT
          b.id_bapb as id,
          b.nomor_bapb,
          b.id_vendor,
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
          v.nama_lengkap as vendor_name
        FROM bapb b
        LEFT JOIN vendor v ON b.id_vendor = v.id_vendor
        WHERE b.id_bapb = ?
      `;
    } else if (type === 'bapp') {
      query = `
        SELECT
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
          v.nama_lengkap as vendor_name
        FROM bapp b
        LEFT JOIN vendor v ON b.id_vendor = v.id_vendor
        WHERE b.id_bapp = ?
      `;
    } else {
      return res.status(400).json({ message: 'Tipe dokumen tidak valid.' });
    }

    // Add vendor restriction if user is a vendor
    if (req.user.role === 'vendor') {
      query += ' AND b.id_vendor = ?';
      params.push(req.user.id);
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Dokumen tidak ditemukan atau akses ditolak.' });
    }

    documentData = rows[0];

    // Parse rincian_barang/rincian_pekerjaan JSON if they are strings
    if (typeof documentData.rincian_barang === 'string') {
      try {
        documentData.rincian_barang = JSON.parse(documentData.rincian_barang);
      } catch (e) {
        console.error('Error parsing rincian_barang JSON:', e);
        documentData.rincian_barang = [];
      }
    }
    if (typeof documentData.rincian_pekerjaan === 'string') {
      try {
        documentData.rincian_pekerjaan = JSON.parse(documentData.rincian_pekerjaan);
      } catch (e) {
        console.error('Error parsing rincian_pekerjaan JSON:', e);
        documentData.rincian_pekerjaan = [];
      }
    }

    const htmlContent = generatePdfHtml(documentData, type);

    // Launch Puppeteer and generate PDF
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });

    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${type.toUpperCase()}-${documentData.nomor_bapp || documentData.nomor_bapb}.pdf"`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ message: 'Gagal menghasilkan PDF', error: error.message });
  }
});

module.exports = router;

