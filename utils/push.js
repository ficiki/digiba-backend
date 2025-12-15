const webPush = require('web-push');
const pool = require('../db');

// Configure web-push
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT) {
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  console.log('✅ VAPID details configured for push notifications.');
} else {
  console.warn('⚠️ VAPID keys are not configured. Push notifications will be disabled.');
}

/**
 * Sends a push notification to a specific user.
 * @param {number} userId - The ID of the user to notify.
 * @param {object} payload - The notification payload.
 * @param {string} payload.title - The title of the notification.
 * @param {string} payload.body - The body text of the notification.
 * @param {object} [payload.data] - Optional data to send with the notification.
 */
async function sendPushNotification(userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY) {
    // Silently fail if VAPID keys are not set
    return;
  }

  console.log(`\n🚀 Attempting to send push notification to user #${userId}`);
  
  try {
    // 1. Get all subscriptions for the user
    const [subscriptions] = await pool.query(
      'SELECT subscription FROM push_subscriptions WHERE user_id = ?',
      [userId]
    );

    if (subscriptions.length === 0) {
      console.log(`- No push subscriptions found for user #${userId}.`);
      return;
    }

    console.log(`- Found ${subscriptions.length} subscription(s) for user #${userId}.`);

    const notificationPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      data: payload.data || {}
    });

    // 2. Send notification to each subscription
    const sendPromises = subscriptions.map(async (row) => {
      const subscription = row.subscription;
      try {
        console.log(`-- Sending to endpoint: ${subscription.endpoint.substring(0, 50)}...`);
        await webPush.sendNotification(subscription, notificationPayload);
        console.log(`--- Push sent successfully.`);
      } catch (err) {
        console.error(`--- Error sending push to ${subscription.endpoint.substring(0, 50)}...`);
        // If status is 410 (Gone), the subscription is expired and should be removed.
        if (err.statusCode === 410) {
          console.log(`--- Subscription expired (410 Gone). Deleting from DB.`);
          await pool.query(
            'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
            [userId, subscription.endpoint]
          );
        } else {
          console.error('--- Push send error details:', err.body);
        }
      }
    });

    await Promise.all(sendPromises);
    console.log('🏁 Finished sending push notifications for user #' + userId);

  } catch (dbError) {
    console.error(`❌ Database error while fetching subscriptions for user #${userId}:`, dbError);
  }
}

module.exports = { sendPushNotification };
