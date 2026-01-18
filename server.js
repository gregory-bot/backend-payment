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
  if (!key) return '';
  
  let parsed = key.replace(/\\n/g, '\n');
  
  if (!parsed.includes('\n') && parsed.includes('-----BEGIN PRIVATE KEY-----')) {
    parsed = parsed.replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n')
                   .replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----');
  }
  
  return parsed;
}

try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: parsePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  console.log('✅ Firebase Admin initialized successfully!');
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
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
    status: 'pending', // Initial status
  };
  await ref.set(order);
  return order;
}

async function updateOrderStatus(orderId, status, mpesaData = null) {
  const updates = { status, updatedAt: new Date().toISOString() };
  if (mpesaData) updates.mpesaData = mpesaData;
  await db.ref(`orders/${orderId}`).update(updates);
}

async function getOrderById(orderId) {
  const snapshot = await db.ref(`orders/${orderId}`).once('value');
  return snapshot.val();
}

/* ======================================================
   📍 API Endpoints
   ====================================================== */

// 1. Health Check
app.get('/api/health', (_, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Gadgets by Crestrock API',
    endpoints: [
      '/api/health',
      '/api/orders (POST)',
      '/api/orders/:id (GET)',
      '/api/mpesa/stk-push (POST)',
      '/api/mpesa/callback (POST)'
    ]
  });
});

// 2. Create Order
app.post('/api/orders', async (req, res) => {
  try {
    const { items, total, customerInfo, paymentMethod } = req.body;
    
    if (!items || !total || !customerInfo || !paymentMethod) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: items, total, customerInfo, paymentMethod' 
      });
    }

    if (!customerInfo.name || !customerInfo.phone || !customerInfo.deliveryAddress) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing customer information: name, phone, and deliveryAddress are required' 
      });
    }

    console.log('📦 Creating order for:', customerInfo.name);
    
    const orderData = {
      items,
      total: parseFloat(total),
      customerInfo: {
        ...customerInfo,
        phone: formatPhone(customerInfo.phone)
      },
      paymentMethod,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const order = await saveOrderToFirebase(orderData);
    
    console.log('✅ Order created with ID:', order.id);
    
    res.status(201).json({
      success: true,
      order,
      message: 'Order created successfully'
    });
  } catch (error) {
    console.error('❌ Error creating order:', error.message);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create order'
    });
  }
});

// 3. Get Order by ID
app.get('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const order = await getOrderById(id);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    res.json({
      success: true,
      order
    });
  } catch (error) {
    console.error('❌ Error fetching order:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order'
    });
  }
});

/* ======================================================
   📱 STK PUSH Endpoint
   ====================================================== */
app.post('/api/mpesa/stk-push', async (req, res) => {
  try {
    const { phoneNumber, amount, orderId, accountReference, transactionDesc } = req.body;
    
    if (!phoneNumber || !amount || !orderId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: phoneNumber, amount, orderId' 
      });
    }

    // Verify order exists
    const order = await getOrderById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
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
        AccountReference: accountReference || `ORDER-${orderId.slice(-8)}`,
        TransactionDesc: transactionDesc || 'Gadgets Purchase',
      },
      { 
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30000
      }
    );

    // Update order with checkout request ID
    await updateOrderStatus(orderId, 'payment_pending', {
      checkoutRequestId: response.data.CheckoutRequestID,
      merchantRequestId: response.data.MerchantRequestID
    });

    console.log('✅ STK Push initiated for order:', orderId);
    
    res.json({
      success: true,
      data: response.data,
      message: 'STK Push initiated successfully'
    });
  } catch (error) {
    console.error('❌ STK Push error:', error.message);
    
    if (error.response) {
      console.error('M-Pesa API Response:', error.response.data);
    }
    
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to initiate STK Push',
      error: error.response?.data || error.message
    });
  }
});

/* ======================================================
   📞 M-Pesa Callback Endpoint
   ====================================================== */
app.post('/api/mpesa/callback', async (req, res) => {
  try {
    console.log('📞 Received M-Pesa callback:', JSON.stringify(req.body, null, 2));
    
    const stk = req.body?.Body?.stkCallback;
    if (!stk) {
      console.log('No STK callback data found');
      return res.json({ ResultCode: 1, ResultDesc: 'No STK callback data' });
    }

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stk;
    
    console.log(`Processing callback for CheckoutRequestID: ${CheckoutRequestID}`);
    console.log(`ResultCode: ${ResultCode}, ResultDesc: ${ResultDesc}`);

    // Find order by checkoutRequestId
    const ordersRef = db.ref('orders');
    const snapshot = await ordersRef
      .orderByChild('mpesaData/checkoutRequestId')
      .equalTo(CheckoutRequestID)
      .once('value');

    if (!snap.exists() || snap.val() === null) {
      console.log('❌ No order found for CheckoutRequestID:', CheckoutRequestID);
      return res.json({ ResultCode: 1, ResultDesc: 'Order not found' });
    }

    const orders = snap.val();
    const orderId = Object.keys(orders)[0];
    const order = orders[orderId];

    if (ResultCode === 0) {
      // Payment successful
      const meta = CallbackMetadata.Item;
      const receiptNumber = meta.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
      const amount = meta.find(i => i.Name === 'Amount')?.Value;
      const phoneNumber = meta.find(i => i.Name === 'PhoneNumber')?.Value;
      
      await updateOrderStatus(orderId, 'paid', {
        receiptNumber,
        amount,
        phoneNumber,
        completedAt: new Date().toISOString()
      });
      
      console.log(`✅ Payment successful for order ${orderId}. Receipt: ${receiptNumber}`);
    } else {
      // Payment failed
      await updateOrderStatus(orderId, 'payment_failed', { 
        reason: ResultDesc,
        failedAt: new Date().toISOString()
      });
      
      console.log(`❌ Payment failed for order ${orderId}: ${ResultDesc}`);
    }

    res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (error) {
    console.error('❌ Callback processing error:', error.message);
    res.json({ ResultCode: 1, ResultDesc: 'Callback processing failed' });
  }
});

/* ======================================================
   ⚠️ 404 Handler for undefined routes
   ====================================================== */
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.originalUrl}`,
    availableRoutes: [
      'GET /api/health',
      'POST /api/orders',
      'GET /api/orders/:id',
      'POST /api/mpesa/stk-push',
      'POST /api/mpesa/callback'
    ]
  });
});

/* ======================================================
   ▶️ Start Server
   ====================================================== */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Health check: https://backend-payment-cv4c.onrender.com/api/health`);
  console.log(`📝 Available endpoints:`);
  console.log(`   POST /api/orders - Create new order`);
  console.log(`   GET  /api/orders/:id - Get order by ID`);
  console.log(`   POST /api/mpesa/stk-push - Initiate M-Pesa payment`);
  console.log(`   POST /api/mpesa/callback - M-Pesa callback (auto)`);
});
