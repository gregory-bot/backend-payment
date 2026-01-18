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
  console.error('❌ Missing Firebase environment variables!');
  console.error('FIREBASE_PROJECT_ID:', !!process.env.FIREBASE_PROJECT_ID);
  console.error('FIREBASE_CLIENT_EMAIL:', !!process.env.FIREBASE_CLIENT_EMAIL);
  console.error('FIREBASE_PRIVATE_KEY:', !!process.env.FIREBASE_PRIVATE_KEY);
  console.error('FIREBASE_DATABASE_URL:', !!process.env.FIREBASE_DATABASE_URL);
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

let db;
try {
  const privateKey = parsePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  
  // Log first 20 chars of private key for debugging (not the whole key)
  console.log('🔧 Private key starts with:', privateKey.substring(0, 50) + '...');
  
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  
  db = admin.database();
  console.log('✅ Firebase Admin initialized successfully!');
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
  console.error('Stack:', error.stack);
  throw error;
}

/* ======================================================
   🚀 Express App Setup
   ====================================================== */
const app = express();
const PORT = process.env.PORT || 10000;

// SIMPLE CORS - allow all origins for now (you can restrict later)
app.use(cors({
  origin: '*', // Allow all origins for debugging
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

// Handle preflight requests
app.options('*', cors());

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log('Origin:', req.headers.origin || 'No origin header');
  console.log('Content-Type:', req.headers['content-type']);
  next();
});

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
console.log('📞 MPESA_SHORT_CODE:', process.env.MPESA_SHORT_CODE || 'Not set');
console.log('🔑 MPESA_CONSUMER_KEY:', process.env.MPESA_CONSUMER_KEY ? 'Set' : 'Not set');

/* ======================================================
   🔐 Get M-Pesa Access Token
   ====================================================== */
async function getMpesaAccessToken() {
  try {
    console.log('🔐 Getting M-Pesa access token...');
    
    if (!MPESA_CONFIG.consumerKey || !MPESA_CONFIG.consumerSecret) {
      throw new Error('M-Pesa consumer key or secret not configured');
    }
    
    const auth = Buffer.from(
      `${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`
    ).toString('base64');

    const response = await axios.get(
      `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: { 
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000,
      }
    );

    console.log('✅ M-Pesa token obtained');
    return response.data.access_token;
  } catch (error) {
    console.error('❌ M-Pesa auth failed:', error.message);
    if (error.response) {
      console.error('M-Pesa API Response:', error.response.data);
      console.error('Status:', error.response.status);
    }
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
  if (!phone) throw new Error('Phone number is required');
  
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '254' + cleaned.slice(1);
  else if (cleaned.startsWith('+254')) cleaned = cleaned.slice(1);
  else if (!cleaned.startsWith('254')) cleaned = '254' + cleaned;

  if (cleaned.length !== 12) {
    console.error(`Invalid phone number length: ${cleaned} (${cleaned.length} digits)`);
    throw new Error(`Invalid phone number: ${phone}. Expected 12 digits after formatting, got ${cleaned.length}`);
  }
  return cleaned;
}

/* ======================================================
   📦 Firebase Helpers
   ====================================================== */
async function saveOrderToFirebase(orderData) {
  try {
    console.log('💾 Saving order to Firebase...');
    const ref = db.ref('orders').push();
    const order = {
      ...orderData,
      id: ref.key,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'pending',
    };
    await ref.set(order);
    console.log('✅ Order saved with ID:', order.id);
    return order;
  } catch (error) {
    console.error('❌ Error saving order to Firebase:', error.message);
    throw error;
  }
}

async function updateOrderStatus(orderId, status, mpesaData = null) {
  try {
    const updates = { 
      status, 
      updatedAt: new Date().toISOString() 
    };
    if (mpesaData) updates.mpesaData = mpesaData;
    
    await db.ref(`orders/${orderId}`).update(updates);
    console.log(`✅ Order ${orderId} updated to status: ${status}`);
  } catch (error) {
    console.error(`❌ Error updating order ${orderId}:`, error.message);
    throw error;
  }
}

async function getOrderById(orderId) {
  try {
    const snapshot = await db.ref(`orders/${orderId}`).once('value');
    return snapshot.val();
  } catch (error) {
    console.error(`❌ Error fetching order ${orderId}:`, error.message);
    throw error;
  }
}

/* ======================================================
   📍 API Endpoints
   ====================================================== */

// 1. Health Check
app.get('/api/health', (req, res) => {
  console.log('🏥 Health check from:', req.headers.origin || 'Unknown');
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Gadgets by Crestrock API',
    firebase: db ? 'Connected' : 'Disconnected',
    mpesa: MPESA_CONFIG.consumerKey ? 'Configured' : 'Not configured',
    cors: 'enabled',
    endpoints: [
      'GET /api/health',
      'POST /api/orders',
      'GET /api/orders/:id',
      'POST /api/mpesa/stk-push',
      'POST /api/mpesa/callback'
    ]
  });
});

// 2. Create Order
app.post('/api/orders', async (req, res) => {
  try {
    console.log('📦 Creating order request received');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    const { items, total, customerInfo, paymentMethod } = req.body;
    
    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Order must contain at least one item' 
      });
    }
    
    if (!total || isNaN(total) || total <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid total amount' 
      });
    }
    
    if (!customerInfo || !customerInfo.name || !customerInfo.phone || !customerInfo.deliveryAddress) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing customer information: name, phone, and deliveryAddress are required' 
      });
    }

    if (!paymentMethod) {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment method is required' 
      });
    }

    console.log('📦 Processing order for:', customerInfo.name);
    
    // Format phone number
    let formattedPhone;
    try {
      formattedPhone = formatPhone(customerInfo.phone);
    } catch (phoneError) {
      return res.status(400).json({
        success: false,
        message: phoneError.message
      });
    }
    
    const orderData = {
      items: items.map(item => ({
        id: item.id || `item-${Date.now()}-${Math.random()}`,
        name: item.name || 'Unknown Product',
        price: parseFloat(item.price) || 0,
        quantity: parseInt(item.quantity) || 1,
        image: item.image || '',
        brand: item.brand || ''
      })),
      total: parseFloat(total),
      customerInfo: {
        ...customerInfo,
        phone: formattedPhone
      },
      paymentMethod,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save to Firebase
    const order = await saveOrderToFirebase(orderData);
    
    console.log('✅ Order created successfully. ID:', order.id);
    
    res.status(201).json({
      success: true,
      order,
      message: 'Order created successfully'
    });
  } catch (error) {
    console.error('❌ Error creating order:', error.message);
    console.error('Stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Internal server error while creating order',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 3. Get Order by ID
app.get('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🔍 Fetching order:', id);
    
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
    console.log('📱 STK Push request received');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    const { phoneNumber, amount, orderId, accountReference, transactionDesc } = req.body;
    
    // Validate required fields
    if (!phoneNumber) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is required' 
      });
    }
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid amount is required' 
      });
    }
    
    if (!orderId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Order ID is required' 
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

    // Get M-Pesa token
    const token = await getMpesaAccessToken();
    
    // Format phone
    const phone = formatPhone(phoneNumber);
    const timestamp = generateTimestamp();
    const password = Buffer.from(
      MPESA_CONFIG.shortCode + MPESA_CONFIG.passKey + timestamp
    ).toString('base64');

    console.log('📞 Calling M-Pesa API...');
    console.log('Phone:', phone);
    console.log('Amount:', amount);
    console.log('Order ID:', orderId);
    console.log('Short Code:', MPESA_CONFIG.shortCode);

    const mpesaPayload = {
      BusinessShortCode: MPESA_CONFIG.shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: phone,
      PartyB: MPESA_CONFIG.shortCode,
      PhoneNumber: phone,
      CallBackURL: process.env.MPESA_CALLBACK_URL || `https://backend-payment-cv4c.onrender.com/api/mpesa/callback`,
      AccountReference: accountReference || `ORDER-${orderId.slice(-8)}`,
      TransactionDesc: transactionDesc || 'Gadgets Purchase',
    };

    console.log('M-Pesa Payload:', JSON.stringify(mpesaPayload, null, 2));

    const response = await axios.post(
      `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
      mpesaPayload,
      { 
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    console.log('✅ M-Pesa API Response:', response.data);

    // Update order with checkout request ID
    await updateOrderStatus(orderId, 'payment_pending', {
      checkoutRequestId: response.data.CheckoutRequestID,
      merchantRequestId: response.data.MerchantRequestID,
      stkPushSentAt: new Date().toISOString(),
      amount: amount,
      phoneNumber: phone
    });

    console.log('✅ STK Push initiated for order:', orderId);
    
    res.json({
      success: true,
      data: response.data,
      message: 'STK Push initiated successfully. Check your phone to complete payment.'
    });
  } catch (error) {
    console.error('❌ STK Push error:', error.message);
    
    if (error.response) {
      console.error('M-Pesa API Error Response:', error.response.data);
      console.error('Status:', error.response.status);
    }
    
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to initiate STK Push',
      error: process.env.NODE_ENV === 'development' ? error.response?.data : undefined
    });
  }
});

/* ======================================================
   📞 M-Pesa Callback Endpoint
   ====================================================== */
app.post('/api/mpesa/callback', async (req, res) => {
  try {
    console.log('📞 Received M-Pesa callback');
    console.log('Callback body:', JSON.stringify(req.body, null, 2));
    
    const stk = req.body?.Body?.stkCallback;
    if (!stk) {
      console.log('⚠️ No STK callback data found');
      return res.json({ ResultCode: 1, ResultDesc: 'No STK callback data' });
    }

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stk;
    
    console.log(`🔍 Processing callback for CheckoutRequestID: ${CheckoutRequestID}`);
    console.log(`ResultCode: ${ResultCode}, ResultDesc: ${ResultDesc}`);

    if (!CheckoutRequestID) {
      console.log('❌ No CheckoutRequestID in callback');
      return res.json({ ResultCode: 1, ResultDesc: 'No CheckoutRequestID' });
    }

    // Find order by checkoutRequestId
    const ordersRef = db.ref('orders');
    const snapshot = await ordersRef
      .orderByChild('mpesaData/checkoutRequestId')
      .equalTo(CheckoutRequestID)
      .once('value');

    if (!snapshot.exists()) {
      console.log('❌ No order found for CheckoutRequestID:', CheckoutRequestID);
      return res.json({ ResultCode: 1, ResultDesc: 'Order not found' });
    }

    const orders = snapshot.val();
    const orderId = Object.keys(orders)[0];
    const order = orders[orderId];

    if (ResultCode === 0) {
      // Payment successful
      console.log('💰 Payment successful for order:', orderId);
      
      let receiptNumber = 'Unknown';
      let amount = 0;
      let phoneNumber = 'Unknown';
      
      if (CallbackMetadata && CallbackMetadata.Item) {
        const meta = CallbackMetadata.Item;
        receiptNumber = meta.find(i => i.Name === 'MpesaReceiptNumber')?.Value || 'Unknown';
        amount = meta.find(i => i.Name === 'Amount')?.Value || 0;
        phoneNumber = meta.find(i => i.Name === 'PhoneNumber')?.Value || 'Unknown';
      }
      
      await updateOrderStatus(orderId, 'paid', {
        receiptNumber,
        amount,
        phoneNumber,
        completedAt: new Date().toISOString(),
        mpesaCallback: req.body
      });
      
      console.log(`✅ Payment recorded. Receipt: ${receiptNumber}, Amount: ${amount}`);
    } else {
      // Payment failed
      console.log('❌ Payment failed for order:', orderId, 'Reason:', ResultDesc);
      
      await updateOrderStatus(orderId, 'payment_failed', { 
        reason: ResultDesc,
        failedAt: new Date().toISOString(),
        mpesaCallback: req.body
      });
    }

    res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (error) {
    console.error('❌ Callback processing error:', error.message);
    console.error('Stack:', error.stack);
    res.json({ ResultCode: 1, ResultDesc: 'Callback processing failed' });
  }
});

/* ======================================================
   ⚠️ 404 Handler for undefined routes
   ====================================================== */
app.use('/api/*', (req, res) => {
  console.log('🔍 Route not found:', req.originalUrl);
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

// Global error handler
app.use((err, req, res, next) => {
  console.error('🔥 Unhandled error:', err.message);
  console.error('Stack:', err.stack);
  
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

/* ======================================================
   ▶️ Start Server
   ====================================================== */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Health check: https://backend-payment-cv4c.onrender.com/api/health`);
  console.log(`🔒 CORS: Enabled for all origins (temporarily for debugging)`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Firebase: ${db ? 'Connected' : 'Disconnected'}`);
});
