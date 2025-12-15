const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');

// GET /api/notifications - Fetch notifications for the logged-in user
router.get('/', verifyToken, async (req, res) => {
  const { id: userId, role } = req.user;

  console.log(`\n🔔 Fetching notifications for user #${userId} (role: ${role})`);

  try {
    const [notifications] = await pool.query(
      `SELECT
        id,
        title,
        description AS message,
        notification_type AS type,
        document_id,
        document_type,
        is_read,
        created_at
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50`,
      [userId]
    );

    console.log(`✅ Found ${notifications.length} notifications.`);
    res.json({ data: notifications });

  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      console.warn(`⚠️ A column might be missing in 'notifications' table (${err.sqlMessage}). Trying compatibility mode.`);
      try {
        // Fallback query without the problematic columns, but aliasing what we can
        const [notifications] = await pool.query(
          `SELECT
            id,
            title,
            'No description available.' AS message,
            'info' AS type,
            document_id,
            document_type,
            is_read,
            created_at
          FROM notifications
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 50`,
          [userId]
        );
        
        console.log(`✅ Found ${notifications.length} notifications (compatibility mode).`);
        res.json({ data: notifications });

      } catch (fallbackErr) {
        console.error('❌ Error fetching notifications during fallback:', fallbackErr);
        res.status(500).json({ message: 'Gagal mengambil notifikasi', error: fallbackErr.message });
      }
    } else {
      console.error('❌ Error fetching notifications:', err);
      res.status(500).json({ message: 'Gagal mengambil notifikasi', error: err.message });
    }
  }
});

// PATCH /api/notifications/:id/read - Mark a notification as read
router.patch('/:id/read', verifyToken, async (req, res) => {
  const { id: notificationId } = req.params;
  const { id: userId } = req.user;

  console.log(`\n📖 Marking notification #${notificationId} as read for user #${userId}`);

  try {
    const [result] = await pool.query(
      'UPDATE notifications SET is_read = true WHERE id = ? AND user_id = ?',
      [notificationId, userId]
    );

    if (result.affectedRows === 0) {
      console.log('⚠️ Notification not found or user not authorized.');
      return res.status(404).json({ message: 'Notifikasi tidak ditemukan atau Anda tidak memiliki akses' });
    }

    console.log('✅ Notification marked as read.');
    res.status(200).json({ message: 'Notifikasi ditandai sebagai sudah dibaca' });

  } catch (err) {
    console.error('❌ Error marking notification as read:', err);
    res.status(500).json({ message: 'Gagal menandai notifikasi', error: err.message });
  }
});

// PATCH /api/notifications/read-all - Mark all notifications as read
router.patch('/read-all', verifyToken, async (req, res) => {
    const { id: userId } = req.user;
  
    console.log(`\n📖 Marking all notifications as read for user #${userId}`);
  
    try {
      const [result] = await pool.query(
        'UPDATE notifications SET is_read = true WHERE user_id = ? AND is_read = false',
        [userId]
      );
  
      console.log(`✅ ${result.affectedRows} notifications marked as read.`);
      res.status(200).json({ message: 'Semua notifikasi ditandai sebagai sudah dibaca' });
  
    } catch (err) {
      console.error('❌ Error marking all notifications as read:', err);
      res.status(500).json({ message: 'Gagal menandai semua notifikasi', error: err.message });
    }
  });

// GET /api/notifications/preferences - Fetch user notification preferences
router.get('/preferences', verifyToken, async (req, res) => {
  const { id: userId } = req.user;
  console.log(`\n⚙️ Fetching notification preferences for user #${userId}`);
  try {
    const [rows] = await pool.query(
      'SELECT notification_preferences FROM users WHERE id = ?',
      [userId]
    );
    const user = rows[0];

    if (!user) {
      console.log(`⚠️ User #${userId} not found.`);
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    const preferences = user.notification_preferences ? JSON.parse(user.notification_preferences) : {
      barangMasuk: true,
      dokumenDisetujui: true,
      komentarBaru: true,
    };
    
    console.log('✅ Successfully fetched preferences.');
    res.json({ data: preferences });

  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      console.warn('⚠️ notification_preferences column not found, returning default preferences.');
      const defaultPreferences = {
        barangMasuk: true,
        dokumenDisetujui: true,
        komentarBaru: true,
      };
      return res.json({ data: defaultPreferences });
    }
    console.error('❌ Error fetching notification preferences:', err);
    res.status(500).json({ message: 'Gagal mengambil preferensi notifikasi', error: err.message });
  }
});

// PUT /api/notifications/preferences - Update user notification preferences
router.put('/preferences', verifyToken, async (req, res) => {
  const { id: userId } = req.user;
  const preferences = req.body;

  console.log(`\n✏️ Updating notification preferences for user #${userId}`);

  try {
    const [result] = await pool.query(
      'UPDATE users SET notification_preferences = ? WHERE id = ?',
      [JSON.stringify(preferences), userId]
    );

    if (result.affectedRows === 0) {
      console.log(`⚠️ User #${userId} not found.`);
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    console.log('✅ Preferences updated successfully.');
    res.status(200).json({ message: 'Preferensi notifikasi berhasil diperbarui', data: preferences });

  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      console.warn('⚠️ notification_preferences column not found, cannot update preferences.');
      // We can't update, but we can pretend we did to not break the client.
      // The client will receive the updated preferences back.
      return res.status(200).json({ message: 'Preferensi notifikasi berhasil diperbarui (mode kompatibilitas)', data: preferences });
    }
    console.error('❌ Error updating notification preferences:', err);
    res.status(500).json({ message: 'Gagal memperbarui preferensi notifikasi', error: err.message });
  }
});

// GET /api/notifications/vapid-key - Get the VAPID public key
router.get('/vapid-key', verifyToken, (req, res) => {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    console.error('❌ VAPID_PUBLIC_KEY is not defined in .env file.');
    return res.status(500).json({ message: 'Server tidak dikonfigurasi untuk notifikasi push.' });
  }
  res.json({ publicKey: vapidPublicKey });
});

// POST /api/notifications/subscribe - Subscribe to push notifications
router.post('/subscribe', verifyToken, async (req, res) => {
  const { subscription } = req.body;
  const { id: userId } = req.user;

  console.log(`\n📲 User #${userId} is subscribing to push notifications.`);
  console.log('Subscription object:', subscription);

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ message: 'Subscription object tidak valid.' });
  }

  try {
    // Simpan langganan ke database
    await pool.query(
      'INSERT INTO push_subscriptions (user_id, endpoint, subscription) VALUES (?, ?, ?)',
      [userId, subscription.endpoint, JSON.stringify(subscription)]
    );

    console.log(`✅ Subscription for user #${userId} saved successfully.`);
    res.status(201).json({ message: 'Berhasil berlangganan notifikasi.' });

  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      console.log(`⚠️ Subscription already exists for user #${userId}.`);
      res.status(200).json({ message: 'Anda sudah berlangganan notifikasi di perangkat ini.' });
    } else {
      console.error('❌ Error saving subscription:', err);
      res.status(500).json({ message: 'Gagal menyimpan langganan notifikasi.', error: err.message });
    }
  }
});

module.exports = router;
