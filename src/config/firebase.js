const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('Firebase Admin initialized successfully');
  } catch (err) {
    console.error('Firebase init error:', err.message);
  }
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