const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const sendNotification = async (token, title, body) => {
  try {
    await admin.messaging().send({
      token,
      notification: { title, body },
      webpush: {
        notification: {
          title,
          body,
          icon: '/icons/icon-192x192.png',
        }
      }
    });
  } catch (err) {
    console.error('FCM send failed:', err.message);
  }
};

module.exports = { sendNotification };