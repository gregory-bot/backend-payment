// server.ts
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const admin = require('firebase-admin');

dotenv.config();

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json'); // You need to create this file

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(bodyParser.json());

// M-Pesa Configuration
const MPESA_CONFIG = {
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  shortCode: process.env.MPESA_SHORT_CODE,
  passKey: process.env.MPESA_PASS_KEY,
  environment: process.env.MPESA_SHORT_CODE === '174379' ? 'sandbox' : 'production'
};

console.log('\n🔧 M-Pesa Configuration Loaded');

const MPESA_BASE_URL = MPESA_CONFIG.environment === 'production' 
  ? 'https://api.safaricom.co.ke' 
  : 'https://sandbox.safaricom.co.ke';

// Get M-Pesa Access Token
async function getMpesaAccessToken() {
  try {
    const auth = Buffer.from(`${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`).toString('base64');
    
    const response = await axios.get(
      `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: { 'Authorization': `Basic ${auth}` },
        timeout: 10000
      }
    );
    
    return response.data.access_token;
    
  } catch (error) {
    console.error('M-Pesa auth failed:', error.message);
    throw new Error(`M-Pesa auth failed: ${error.message}`);
  }
}

// Generate timestamp
function generateTimestamp() {
  const date = new Date();
  return date.getFullYear() + 
    String(date.getMonth() + 1).padStart(2, '0') + 
    String(date.getDate()).padStart(2, '0') + 
    String(date.getHours()).padStart(2, '0') + 
    String(date.getMinutes()).padStart(2, '0') + 
    String(date.getSeconds()).padStart(2, '0');
}

// Format phone
function formatPhone(phone) {
  let cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.substring(1);
  } else if (cleaned.startsWith('254')) {
    // Already in 254 format
  } else if (cleaned.startsWith('+254')) {
    cleaned = cleaned.substring(1);
  } else {
    cleaned = '254' + cleaned;
  }
  
  if (cleaned.length !== 12) {
    throw new Error(`Invalid phone length: ${cleaned}. Expected 12 digits, got ${cleaned.length}`);
  }
  
  return cleaned;
}

// Save order to Firebase
async function saveOrderToFirebase(orderData) {
  try {
    const orderRef = db.ref('orders').push();
    const orderId = orderRef.key;
    
    const order = {
      ...orderData,
      id: orderId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await orderRef.set(order);
    console.log(`✅ Order saved to Firebase: ${orderId}`);
    
    return order;
  } catch (error) {
    console.error('❌ Error saving order to Firebase:', error);
    throw error;
  }
}

// Update order status in Firebase
async function updateOrderStatus(orderId, status, mpesaData = null) {
  try {
    const orderRef = db.ref(`orders/${orderId}`);
    const updates = {
      status,
      updatedAt: new Date().toISOString()
    };
    
    if (mpesaData) {
      updates.mpesaData = mpesaData;
    }
    
    await orderRef.update(updates);
    console.log(`✅ Order ${orderId} status updated to: ${status}`);
  } catch (error) {
    console.error('❌ Error updating order status:', error);
    throw error;
  }
}

// Create notification in Firebase
async function createNotification(message, type = 'info', orderId = null) {
  try {
    const notificationRef = db.ref('notifications').push();
    const notification = {
      id: notificationRef.key,
      message,
      type,
      time: new Date().toISOString(),
      read: false,
      orderId: orderId
    };
    
    await notificationRef.set(notification);
    console.log(`📢 Notification created: ${message}`);
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}

// STK Push
app.post('/api/mpesa/stk-push', async (req, res) => {
  console.log('\n📱 STK Push Request:', req.body);
  
  try {
    const { phoneNumber, amount, orderId, accountReference, transactionDesc } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }
    
    if (!amount || amount < 1) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required (minimum 1 KSh)'
      });
    }
    
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }
    
    // Verify order exists in Firebase
    const orderRef = db.ref(`orders/${orderId}`);
    const orderSnapshot = await orderRef.once('value');
    
    if (!orderSnapshot.exists()) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    const token = await getMpesaAccessToken();
    
    let phone;
    try {
      phone = formatPhone(phoneNumber);
      console.log('✅ Formatted phone:', phone);
    } catch (phoneError) {
      return res.status(400).json({
        success: false,
        message: phoneError.message
      });
    }
    
    const timestamp = generateTimestamp();
    const password = Buffer.from(
      MPESA_CONFIG.shortCode + 
      MPESA_CONFIG.passKey + 
      timestamp
    ).toString('base64');
    
    const callbackUrl = process.env.MPESA_CALLBACK_URL || `https://backend-payment-cv4c.onrender.com/api/mpesa/callback`;
    
    const requestData = {
      BusinessShortCode: MPESA_CONFIG.shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: phone,
      PartyB: MPESA_CONFIG.shortCode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: accountReference || 'GadgetsByCrestrock',
      TransactionDesc: transactionDesc || 'Purchase from Gadgets by Crestrock'
    };
    
    console.log('\n📤 Sending to M-Pesa API...');
    
    const response = await axios.post(
      `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
      requestData,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    
    console.log('✅ M-Pesa STK Push Success:', response.data);
    
    // Update order with M-Pesa request info
    await orderRef.update({
      mpesaRequestId: response.data.MerchantRequestID,
      checkoutRequestId: response.data.CheckoutRequestID,
      status: 'payment_pending',
      updatedAt: new Date().toISOString()
    });
    
    // Create notification
    await createNotification(
      `M-Pesa payment initiated for order ${orderId}`,
      'info',
      orderId
    );
    
    res.json({
      success: true,
      data: response.data,
      message: 'Payment request sent. Check your phone to complete payment.'
    });
    
  } catch (error) {
    console.error('❌ STK Push failed:', error.message);
    
    let errorMessage = 'Payment request failed';
    let statusCode = 500;
    
    if (error.response) {
      statusCode = error.response.status;
      
      if (error.response.data && error.response.data.errorMessage) {
        errorMessage = error.response.data.errorMessage;
      }
    }
    
    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: error.response?.data || error.message
    });
  }
});

// M-Pesa Callback - Handle payment confirmation
app.post('/api/mpesa/callback', async (req, res) => {
  console.log('\n📞 M-Pesa Callback Received:');
  console.log('Body:', JSON.stringify(req.body, null, 2));
  
  try {
    const callbackData = req.body;
    
    if (!callbackData.Body || !callbackData.Body.stkCallback) {
      console.log('Invalid callback format');
      return res.json({ ResultCode: 1, ResultDesc: 'Invalid callback format' });
    }
    
    const stkCallback = callbackData.Body.stkCallback;
    const resultCode = stkCallback.ResultCode;
    const resultDesc = stkCallback.ResultDesc;
    const checkoutRequestId = stkCallback.CheckoutRequestID;
    
    console.log(`ResultCode: ${resultCode}, ResultDesc: ${resultDesc}`);
    
    // Find order by checkoutRequestId
    const ordersRef = db.ref('orders');
    const ordersSnapshot = await ordersRef.orderByChild('checkoutRequestId').equalTo(checkoutRequestId).once('value');
    
    if (ordersSnapshot.exists()) {
      const orders = ordersSnapshot.val();
      const orderId = Object.keys(orders)[0];
      const order = orders[orderId];
      
      if (resultCode === 0) {
        // Payment successful
        const callbackMetadata = stkCallback.CallbackMetadata;
        const item = callbackMetadata?.Item || [];
        
        const mpesaReceiptNumber = item.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
        const phoneNumber = item.find(i => i.Name === 'PhoneNumber')?.Value;
        const amount = item.find(i => i.Name === 'Amount')?.Value;
        
        console.log(`💰 Payment successful for order ${orderId}`);
        console.log(`Receipt: ${mpesaReceiptNumber}, Amount: ${amount}, Phone: ${phoneNumber}`);
        
        // Update order status to 'paid'
        await updateOrderStatus(orderId, 'paid', {
          mpesaReceiptNumber,
          phoneNumber,
          amount,
          paidAt: new Date().toISOString()
        });
        
        // Create success notification
        await createNotification(
          `Payment received for order ${orderId} - KSh ${amount}`,
          'success',
          orderId
        );
        
        // Send customer notification (you can integrate SMS or email here)
        console.log(`📱 Send delivery confirmation to customer: ${order.customerInfo.phone}`);
        
      } else {
        // Payment failed
        console.log(`❌ Payment failed for order ${orderId}: ${resultDesc}`);
        
        await updateOrderStatus(orderId, 'payment_failed', {
          errorCode: resultCode,
          errorMessage: resultDesc
        });
        
        await createNotification(
          `Payment failed for order ${orderId}: ${resultDesc}`,
          'error',
          orderId
        );
      }
    } else {
      console.log(`⚠️ Order not found for checkoutRequestId: ${checkoutRequestId}`);
    }
    
    // Always respond with success to M-Pesa
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
    
  } catch (error) {
    console.error('❌ Error processing callback:', error);
    res.json({ ResultCode: 1, ResultDesc: 'Error processing callback' });
  }
});

// Create order endpoint
app.post('/api/orders', async (req, res) => {
  try {
    console.log('📦 Create Order Request:', req.body);
    
    const { items, total, customerInfo, paymentMethod } = req.body;
    
    if (!items || !items.length) {
      return res.status(400).json({
        success: false,
        message: 'No items in order'
      });
    }
    
    if (!customerInfo || !customerInfo.name || !customerInfo.phone) {
      return res.status(400).json({
        success: false,
        message: 'Customer information is required'
      });
    }
    
    const orderData = {
      items,
      total,
      customerInfo,
      paymentMethod,
      status: paymentMethod === 'mpesa' ? 'pending_payment' : 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const order = await saveOrderToFirebase(orderData);
    
    // Create notification
    await createNotification(
      `New order ${order.id} from ${customerInfo.name}`,
      'info',
      order.id
    );
    
    console.log('✅ Order created successfully:', order.id);
    
    res.json({
      success: true,
      order,
      message: 'Order created successfully'
    });
    
  } catch (error) {
    console.error('❌ Order creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: error.message
    });
  }
});

// Get order by ID
app.get('/api/orders/:orderId', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const orderRef = db.ref(`orders/${orderId}`);
    const orderSnapshot = await orderRef.once('value');
    
    if (!orderSnapshot.exists()) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }
    
    const order = orderSnapshot.val();
    
    res.json({ 
      success: true, 
      order 
    });
    
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch order' 
    });
  }
});

// Webhook for testing (optional)
app.post('/api/webhook/test-payment', async (req, res) => {
  console.log('Test webhook received:', req.body);
  
  // Simulate a successful payment for testing
  const { orderId, amount, phoneNumber } = req.body;
  
  if (!orderId) {
    return res.status(400).json({ error: 'orderId is required' });
  }
  
  try {
    await updateOrderStatus(orderId, 'paid', {
      mpesaReceiptNumber: 'TEST' + Date.now(),
      phoneNumber: phoneNumber || '254700000000',
      amount: amount || 1,
      paidAt: new Date().toISOString(),
      test: true
    });
    
    await createNotification(
      `Test payment received for order ${orderId}`,
      'success',
      orderId
    );
    
    res.json({ 
      success: true, 
      message: 'Test payment processed' 
    });
    
  } catch (error) {
    console.error('Test webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Gadgets by Crestrock API',
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      MPESA_ENV: MPESA_CONFIG.environment
    },
    firebase: {
      connected: true
    }
  };

  res.json(health);
});

// Start server
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`🚀 Backend server running on port ${PORT}`);
  console.log(`📱 M-Pesa Environment: ${MPESA_CONFIG.environment}`);
  console.log(`🔗 Health check: https://backend-payment-cv4c.onrender.com/api/health`);
  console.log(`💰 Order endpoint: POST /api/orders`);
  console.log(`💳 Payment endpoint: POST /api/mpesa/stk-push`);
  console.log(`📞 Callback endpoint: POST /api/mpesa/callback`);
  console.log(`========================================\n`);
});
