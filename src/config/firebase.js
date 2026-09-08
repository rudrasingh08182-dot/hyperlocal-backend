const admin = require('firebase-admin');
const { cert } = require('firebase-admin/app');

if (!admin.getApps().length) {
  try {
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    );
    admin.initializeApp({
      credential: cert(serviceAccount),
    });
    console.log('✅ Firebase Admin initialized successfully');
  } catch (err) {
    console.error('Firebase init error:', err.message);
  }
}

/**
 * Ek single user ko notification bhejo
 * @param {string} token - FCM token
 * @param {string} title
 * @param {string} body
 * @param {object} data - optional key-value pairs (saari values string honi chahiye)
 */
const sendNotification = async (token, title, body, data = {}) => {
  if (!token) return;
  try {
    // Convert all data values to strings (FCM requirement)
    const stringData = {};
    for (const [k, v] of Object.entries(data)) {
      stringData[k] = String(v);
    }

    await admin.messaging().send({
      token,
      notification: { title, body },
      data: stringData,
      webpush: {
        notification: {
          title,
          body,
          icon: '/icons/icon-192x192.png',
          badge: '/icons/icon-72x72.png',
          click_action: '/',
        },
        fcm_options: { link: '/' },
      },
    });
    console.log('✅ FCM notification sent');
  } catch (err) {
    // Invalid/expired token — log karo but crash mat karo
    console.error('FCM send failed:', err.message);
  }
};

/**
 * Multiple users ko ek saath notification bhejo (max 500 per batch)
 * @param {string[]} tokens - FCM tokens array
 * @param {string} title
 * @param {string} body
 * @param {object} data
 */
const sendToMany = async (tokens, title, body, data = {}) => {
  if (!tokens || tokens.length === 0) return { successCount: 0, failureCount: 0 };

  // Firebase allows max 500 tokens per multicast call — batch karo
  const BATCH_SIZE = 500;
  const validTokens = tokens.filter(Boolean); // null/undefined hata do
  let successCount = 0;
  let failureCount = 0;

  const stringData = {};
  for (const [k, v] of Object.entries(data)) {
    stringData[k] = String(v);
  }

  for (let i = 0; i < validTokens.length; i += BATCH_SIZE) {
    const batch = validTokens.slice(i, i + BATCH_SIZE);
    try {
      const response = await admin.messaging().sendEachForMulticast({
        tokens: batch,
        notification: { title, body },
        data: stringData,
        webpush: {
          notification: {
            title,
            body,
            icon: '/icons/icon-192x192.png',
            badge: '/icons/icon-72x72.png',
          },
        },
      });
      successCount += response.successCount;
      failureCount += response.failureCount;
    } catch (err) {
      console.error('FCM multicast error:', err.message);
      failureCount += batch.length;
    }
  }

  console.log(`✅ FCM Broadcast done — sent: ${successCount}, failed: ${failureCount}`);
  return { successCount, failureCount };
};

module.exports = { sendNotification, sendToMany };