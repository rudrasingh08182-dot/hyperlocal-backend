// src/config/firebase.js
// Firebase Admin SDK — push notifications ke liye (firebase-admin v12+ modular API)

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getMessaging }                  = require('firebase-admin/messaging');

// Sirf ek baar initialize karo
if (getApps().length === 0) {
  try {
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    );
    initializeApp({ credential: cert(serviceAccount) });
    console.log('✅ Firebase Admin initialized successfully');
  } catch (err) {
    console.error('❌ Firebase Admin init error:', err.message);
  }
}

/**
 * Ek single user ko notification bhejo
 * @param {string} token  — FCM device token
 * @param {string} title
 * @param {string} body
 * @param {object} data   — optional key-value pairs (saari values string honi chahiye)
 */
const sendNotification = async (token, title, body, data = {}) => {
  if (!token) return;
  try {
    // FCM requirement: data object mein saari values string honi chahiye
    const stringData = {};
    for (const [k, v] of Object.entries(data)) {
      stringData[k] = String(v);
    }

    await getMessaging().send({
      token,
      notification: { title, body },
      data: stringData,
      webpush: {
        notification: {
          title,
          body,
          icon:  '/icons/icon-192x192.png',
          badge: '/icons/icon-72x72.png',
        },
        fcm_options: { link: '/' },
      },
    });
    console.log('✅ FCM notification sent to token:', token.slice(0, 20) + '...');
  } catch (err) {
    // Invalid/expired token — log karo but server crash mat karo
    console.error('❌ FCM send failed:', err.message);
  }
};

/**
 * Multiple users ko ek saath notification bhejo (max 500 per batch — FCM limit)
 * @param {string[]} tokens  — FCM tokens array
 * @param {string}   title
 * @param {string}   body
 * @param {object}   data
 */
const sendToMany = async (tokens, title, body, data = {}) => {
  if (!tokens || tokens.length === 0) return { successCount: 0, failureCount: 0 };

  const BATCH_SIZE  = 500;
  const validTokens = tokens.filter(Boolean); // null/undefined tokens hata do
  let successCount  = 0;
  let failureCount  = 0;

  const stringData = {};
  for (const [k, v] of Object.entries(data)) {
    stringData[k] = String(v);
  }

  for (let i = 0; i < validTokens.length; i += BATCH_SIZE) {
    const batch = validTokens.slice(i, i + BATCH_SIZE);
    try {
      const response = await getMessaging().sendEachForMulticast({
        tokens: batch,
        notification: { title, body },
        data: stringData,
        webpush: {
          notification: {
            title,
            body,
            icon:  '/icons/icon-192x192.png',
            badge: '/icons/icon-72x72.png',
          },
        },
      });
      successCount += response.successCount;
      failureCount += response.failureCount;
    } catch (err) {
      console.error('❌ FCM multicast error:', err.message);
      failureCount += batch.length;
    }
  }

  console.log(`✅ FCM Broadcast — sent: ${successCount}, failed: ${failureCount}`);
  return { successCount, failureCount };
};

module.exports = { sendNotification, sendToMany };