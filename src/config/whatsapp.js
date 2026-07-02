const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const sendWhatsApp = async (to, message) => {
  try {
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: `whatsapp:+91${to}`,
      body: message,
    });
    console.log('WhatsApp sent to:', to);
  } catch (err) {
    console.error('WhatsApp error:', err.message);
  }
};

module.exports = { sendWhatsApp };