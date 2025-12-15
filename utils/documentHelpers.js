// server/utils/documentHelpers.js
const pool = require('../db'); // Assuming db.js exports the connection pool

const fetchDocumentRelations = async (jenis_dokumen, id_dokumen) => {
  let timeline = [];
  let lampiran = [];
  let picTerakhir = null;

  try {
    // Fetch document history (timeline)
    const [historyRows] = await pool.query(
      `SELECT
        aktivitas as action,
        actor_name as oleh,
        actor_role, -- Need actor_role to filter for picTerakhir
        created_at as tanggal,
        keterangan as catatan,
        status_sesudah as status
      FROM document_history
      WHERE jenis_dokumen = ? AND id_dokumen = ?
      ORDER BY created_at ASC`,
      [jenis_dokumen, id_dokumen]
    );
    timeline = historyRows;

    // Determine picTerakhir
    const lastPicActivity = historyRows
      .filter(entry => entry.actor_role === 'pic')
      .sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));

    if (lastPicActivity.length > 0) {
      picTerakhir = lastPicActivity[0].oleh;
    }


    // Fetch lampiran (attachments)
    const [lampiranRows] = await pool.query(
      `SELECT
        id_lampiran as id,
        nama_file_asli as nama,
        mime_type as tipe,
        nama_file_tersimpan as path,
        keterangan,
        uploaded_at
      FROM lampiran
      WHERE jenis_dokumen = ? AND id_dokumen = ?
      ORDER BY uploaded_at ASC`,
      [jenis_dokumen, id_dokumen]
    );

    lampiran = lampiranRows.map(file => ({
      ...file,
      // Frontend will construct the download URL, e.g., /api/upload/download/${file.id}
    }));

  } catch (err) {
    console.error(`Error fetching relations for ${jenis_dokumen} ID ${id_dokumen}:`, err);
    // Return empty arrays/null on error to avoid breaking the main document fetch
  }

  return { timeline, lampiran, picTerakhir };
};

module.exports = { fetchDocumentRelations };
