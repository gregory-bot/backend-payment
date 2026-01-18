/* ======================================================
   🔧 Environment & Dependencies
   ====================================================== */
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const admin = require('firebase-admin');

dotenv.config();

// Debug private key format
console.log('🔍 Debugging Firebase Private Key:');
console.log('First 100 chars:', process.env.FIREBASE_PRIVATE_KEY?.substring(0, 100));
console.log('Contains \\\\n (escaped):', process.env.FIREBASE_PRIVATE_KEY?.includes('\\n'));
console.log('Contains actual newline:', process.env.FIREBASE_PRIVATE_KEY?.includes('\n'));
console.log('Key length:', process.env.FIREBASE_PRIVATE_KEY?.length);

/* ======================================================
   🔥 Firebase Admin Initialization (Render-Compatible)
   ====================================================== */
if (
  !process.env.FIREBASE_PROJECT_ID ||
  !process.env.FIREBASE_CLIENT_EMAIL ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  !process.env.FIREBASE_DATABASE_URL
) {
  throw new Error('Missing Firebase environment variables!');
}

// Robust private key parser
function parsePrivateKey(key) {
  if (!key) {
    console.error('❌ Private key is empty or undefined');
    return '';
  }
  
  console.log('🔧 Raw key starts with:', key.substring(0, 30));
  
  // First, try to replace escaped newlines
  let parsed = key.replace(/\\n/g, '\n');
  
  // Check if we have proper PEM format
  const hasBeginMarker = parsed.includes('-----BEGIN PRIVATE KEY-----');
  const hasEndMarker = parsed.includes('-----END PRIVATE KEY-----');
  
  console.log('Has BEGIN marker:', hasBeginMarker);
  console.log('Has END marker:', hasEndMarker);
  console.log('Has newlines after parsing:', parsed.includes('\n'));
  
  if (!parsed.includes('\n') && hasBeginMarker && hasEndMarker) {
    console.log('⚠️ No newlines detected, trying to reconstruct PEM format...');
    // Try to reconstruct PEM format
    parsed = parsed.replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n');
    parsed = parsed.replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----');
    
    // Try to add line breaks to the base64 content (64 chars per line)
    const beginIndex = parsed.indexOf('-----BEGIN PRIVATE KEY-----\n') + '-----BEGIN PRIVATE KEY-----\n'.length;
    const endIndex = parsed.indexOf('\n-----END PRIVATE KEY-----');
    
    if (beginIndex < endIndex) {
      const base64Content = parsed.substring(beginIndex, endIndex).replace(/\s+/g, '');
      const formattedBase64 = base64Content.replace(/(.{64})/g, '$1\n').trim();
      parsed = `-----BEGIN PRIVATE KEY-----\n${formattedBase64}\n-----END PRIVATE KEY-----\n`;
    }
  }
  
  // Ensure it ends with a newline
  if (!parsed.endsWith('\n')) {
    parsed += '\n';
  }
  
  console.log('🔧 Parsed key first 50 chars:', parsed.substring(0, 50));
  console.log('🔧 Parsed key last 50 chars:', parsed.substring(parsed.length - 50));
  
  return parsed;
}

try {
  const privateKey = parsePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  
  // Additional validation
  if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    console.error('❌ Parsed key missing BEGIN marker');
    console.error('Parsed key:', privateKey);
  }
  
  if (!privateKey.includes('-----END PRIVATE KEY-----')) {
    console.error('❌ Parsed key missing END marker');
    console.error('Parsed key:', privateKey);
  }
  
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  
  console.log('✅ Firebase Admin initialized successfully!');
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
  console.error('Full error:', error);
  throw error;
}

const db = admin.database();

/* ======================================================
   🚀 Express App Setup
   ====================================================== */
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(bodyParser.json());

/* ======================================================
   💳 M-Pesa Configuration
   ====================================================== */
const MPESA_CONFIG = {
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  shortCode: process.env.MPESA_SHORT_CODE,
  passKey: process.env.MPESA_PASS_KEY,
  environment: process.env.MPESA_SHORT_CODE === '174379' ? 'sandbox' : 'production',
};

const MPESA_BASE_URL =
  MPESA_CONFIG.environment === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

console.log('🔧 M-Pesa Config Loaded:', MPESA_CONFIG.environment);

/* ======================================================
   🔐 Get M-Pesa Access Token
   ====================================================== */
async function getMpesaAccessToken() {
  try {
    const auth = Buffer.from(
      `${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`
    ).toString('base64');

    const response = await axios.get(
      `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: { Authorization: `Basic ${auth}` },
        timeout: 10000,
      }
    );

    return response.data.access_token;
  } catch (error) {
    console.error('❌ M-Pesa auth failed:', error.message);
    throw new Error(`M-Pesa auth failed: ${error.message}`);
  }
}

/* ======================================================
   🕒 Utilities
   ====================================================== */
function generateTimestamp() {
  const d = new Date();
  return (
    d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0') +
    String(d.getSeconds()).padStart(2, '0')
  );
}

function formatPhone(phone) {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '254' + cleaned.slice(1);
  else if (cleaned.startsWith('+254')) cleaned = cleaned.slice(1);
  else if (!cleaned.startsWith('254')) cleaned = '254' + cleaned;

  if (cleaned.length !== 12) throw new Error(`Invalid phone number: ${cleaned}`);
  return cleaned;
}

/* ======================================================
   📦 Firebase Helpers
   ====================================================== */
async function saveOrderToFirebase(orderData) {
  const ref = db.ref('orders').push();
  const order = {
    ...orderData,
    id: ref.key,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await ref.set(order);
  return order;
}

async function updateOrderStatus(orderId, status, mpesaData = null) {
  const updates = { status, updatedAt: new Date().toISOString() };
  if (mpesaData) updates.mpesaData = mpesaData;
  await db.ref(`orders/${orderId}`).update(updates);
}

async function createNotification(message, type = 'info', orderId = null) {
  const ref = db.ref('notifications').push();
  await ref.set({
    id: ref.key,
    message,
    type,
    orderId,
    read: false,
    time: new Date().toISOString(),
  });
}

/* ======================================================
   📱 STK PUSH Endpoint
   ====================================================== */
app.post('/api/mpesa/stk-push', async (req, res) => {
  try {
    const { phoneNumber, amount, orderId } = req.body;
    if (!phoneNumber || !amount || !orderId) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    const token = await getMpesaAccessToken();
    const phone = formatPhone(phoneNumber);
    const timestamp = generateTimestamp();
    const password = Buffer.from(
      MPESA_CONFIG.shortCode + MPESA_CONFIG.passKey + timestamp
    ).toString('base64');

    const response = await axios.post(
      `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: MPESA_CONFIG.shortCode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: phone,
        PartyB: MPESA_CONFIG.shortCode,
        PhoneNumber: phone,
        CallBackURL:
          process.env.MPESA_CALLBACK_URL ||
          `https://backend-payment-cv4c.onrender.com/api/mpesa/callback`,
        AccountReference: 'GadgetsByCrestrock',
        TransactionDesc: 'Gadgets Purchase',
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    await db.ref(`orders/${orderId}`).update({
      checkoutRequestId: response.data.CheckoutRequestID,
      status: 'payment_pending',
    });

    await createNotification(`Payment initiated for order ${orderId}`, 'info', orderId);

    res.json({ success: true, data: response.data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ======================================================
   📞 M-Pesa Callback Endpoint
   ====================================================== */
app.post('/api/mpesa/callback', async (req, res) => {
  try {
    const stk = req.body?.Body?.stkCallback;
    if (!stk) return res.json({ ResultCode: 1 });

    const snap = await db
      .ref('orders')
      .orderByChild('checkoutRequestId')
      .equalTo(stk.CheckoutRequestID)
      .once('value');

    if (snap.exists()) {
      const [orderId] = Object.keys(snap.val());

      if (stk.ResultCode === 0) {
        const meta = stk.CallbackMetadata.Item;
        await updateOrderStatus(orderId, 'paid', {
          receipt: meta.find(i => i.Name === 'MpesaReceiptNumber')?.Value,
          amount: meta.find(i => i.Name === 'Amount')?.Value,
        });
      } else {
        await updateOrderStatus(orderId, 'payment_failed', { reason: stk.ResultDesc });
      }
    }

    res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch {
    res.json({ ResultCode: 1 });
  }
});

/* ======================================================
   🧪 Health Check
   ====================================================== */
app.get('/api/health', (_, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Gadgets by Crestrock API',
  });
});

/* ======================================================
   ▶️ Start Server
   ====================================================== */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
