const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000; // Use 10000 for Render

// Simple CORS
app.use(cors());
app.use(bodyParser.json());

// M-Pesa Configuration - Load from .env
const MPESA_CONFIG = {
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  shortCode: process.env.MPESA_SHORT_CODE,
  passKey: process.env.MPESA_PASS_KEY,
  // Determine environment based on short code
  environment: process.env.MPESA_SHORT_CODE === '174379' ? 'sandbox' : 'production'
};

console.log('\n🔍 Environment Variables Check:');
console.log('MPESA_CALLBACK_URL:', process.env.MPESA_CALLBACK_URL || 'NOT SET');
console.log('PORT:', process.env.PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('MPESA_SHORT_CODE:', process.env.MPESA_SHORT_CODE ? '***SET***' : 'NOT SET');

console.log('\n🔧 M-Pesa Configuration:');
console.log('- Environment:', MPESA_CONFIG.environment);
console.log('- Short Code:', MPESA_CONFIG.shortCode);
console.log('- Consumer Key:', MPESA_CONFIG.consumerKey ? '***SET***' : '❌ MISSING');
console.log('- Consumer Secret:', MPESA_CONFIG.consumerSecret ? '***SET***' : '❌ MISSING');
console.log('- Pass Key:', MPESA_CONFIG.passKey ? '***SET***' : '❌ MISSING');

// Validate required credentials
if (!MPESA_CONFIG.consumerKey || !MPESA_CONFIG.consumerSecret) {
  console.error('❌ ERROR: M-Pesa credentials are missing in .env file!');
  console.error('Please check your .env file has:');
  console.error('- MPESA_CONSUMER_KEY');
  console.error('- MPESA_CONSUMER_SECRET');
  console.error('- MPESA_SHORT_CODE');
  console.error('- MPESA_PASS_KEY');
}

const MPESA_BASE_URL = MPESA_CONFIG.environment === 'production' 
  ? 'https://api.safaricom.co.ke' 
  : 'https://sandbox.safaricom.co.ke';

console.log('- Base URL:', MPESA_BASE_URL);

// Get M-Pesa Access Token
async function getMpesaAccessToken() {
  try {
    console.log('🔑 Requesting M-Pesa token...');
    
    if (!MPESA_CONFIG.consumerKey || !MPESA_CONFIG.consumerSecret) {
      throw new Error('M-Pesa credentials not configured');
    }
    
    const auth = Buffer.from(`${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`).toString('base64');
    
    const response = await axios.get(
      `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: { 'Authorization': `Basic ${auth}` },
        timeout: 10000
      }
    );
    
    console.log('✅ Token received, length:', response.data.access_token?.length);
    return response.data.access_token;
    
  } catch (error) {
    console.error('❌ Token error:');
    console.error('Message:', error.message);
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
      
      if (error.response.status === 400) {
        console.error('⚠️  Likely issue: Invalid credentials');
        console.error('   Check your Consumer Key and Secret in .env');
      } else if (error.response.status === 404) {
        console.error('⚠️  Likely issue: Wrong base URL for environment');
        console.error('   Production URL:', MPESA_CONFIG.environment === 'production' ? '✅ Using production' : '❌ Should use production');
      }
    } else if (error.code === 'ECONNREFUSED') {
      console.error('⚠️  Cannot connect to M-Pesa API');
      console.error('   Check your internet connection');
    }
    
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
  
  // Remove leading 0 or +254
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

// STK Push
app.post('/api/mpesa/stk-push', async (req, res) => {
  console.log('\n📱 STK Push Request:', req.body);
  
  try {
    const { phoneNumber, amount, orderId, accountReference, transactionDesc } = req.body;
    
    // Validate
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
    
    // Get token
    const token = await getMpesaAccessToken();
    
    // Format phone
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
    
    // Generate timestamp and password
    const timestamp = generateTimestamp();
    const password = Buffer.from(
      MPESA_CONFIG.shortCode + 
      MPESA_CONFIG.passKey + 
      timestamp
    ).toString('base64');
    
    // DEBUG: Show what CallBackURL is being used
    const callbackUrl = process.env.MPESA_CALLBACK_URL || `https://backend-payment-cv4c.onrender.com/api/mpesa/callback`;
    console.log('\n🔗 CallBackURL Configuration:');
    console.log('- From env MPESA_CALLBACK_URL:', process.env.MPESA_CALLBACK_URL || 'NOT SET');
    console.log('- Using CallBackURL:', callbackUrl);
    console.log('- Contains localhost?:', callbackUrl.includes('localhost'));
    console.log('- Is HTTPS?:', callbackUrl.startsWith('https://'));
    
    if (callbackUrl.includes('localhost')) {
      console.error('❌ CRITICAL ERROR: CallBackURL contains localhost!');
      console.error('   M-Pesa production requires a public HTTPS URL');
      console.error('   Update MPESA_CALLBACK_URL in Render environment variables');
    }
    
    // Prepare request
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
    console.log('URL:', `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`);
    console.log('BusinessShortCode:', MPESA_CONFIG.shortCode);
    console.log('Amount:', Math.round(amount));
    console.log('Phone:', phone);
    console.log('CallBackURL:', callbackUrl);
    
    // Send to M-Pesa
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
    
    res.json({
      success: true,
      data: response.data,
      message: 'Payment request sent. Check your phone to complete payment.'
    });
    
  } catch (error) {
    console.error('❌ STK Push failed:');
    console.error('Error:', error.message);
    
    let errorMessage = 'Payment request failed';
    let statusCode = 500;
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
      statusCode = error.response.status;
      
      if (error.response.data && error.response.data.errorMessage) {
        errorMessage = error.response.data.errorMessage;
        
        // Special handling for CallBackURL errors
        if (error.response.data.errorMessage.includes('CallBackURL')) {
          errorMessage += '\n\n⚠️  SOLUTION:';
          errorMessage += '\n1. Set MPESA_CALLBACK_URL in Render environment variables';
          errorMessage += '\n2. Use: https://backend-payment-cv4c.onrender.com/api/mpesa/callback';
          errorMessage += '\n3. Whitelist this URL in Safaricom Daraja portal';
        }
      } else if (error.response.data && error.response.data.errorCode) {
        errorMessage = `M-Pesa error: ${error.response.data.errorCode}`;
      }
    } else if (error.request) {
      console.error('No response received');
      errorMessage = 'No response from M-Pesa API. Please try again.';
    }
    
    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: error.response?.data || error.message,
      environment: MPESA_CONFIG.environment,
      tip: MPESA_CONFIG.environment === 'production' 
        ? 'Using production credentials. Test with a real M-Pesa account.' 
        : 'For sandbox testing: phone=254708374149, PIN=4103'
    });
  }
});

// M-Pesa Callback
app.post('/api/mpesa/callback', (req, res) => {
  console.log('\n📞 M-Pesa Callback Received:');
  console.log('Callback URL:', req.originalUrl);
  console.log('Method:', req.method);
  console.log('Headers:', req.headers);
  console.log('Body:', JSON.stringify(req.body, null, 2));
  
  // Process callback data here
  // In production: update database, send notifications, etc.
  
  // Always respond with success to M-Pesa
  res.json({ ResultCode: 0, ResultDesc: 'Success' });
});

// Health check endpoint with more details
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Gadgets by Crestrock API',
    url: req.protocol + '://' + req.get('host') + req.originalUrl,
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      MPESA_CALLBACK_URL: process.env.MPESA_CALLBACK_URL ? 'SET' : 'NOT SET'
    },
    mpesa: {
      environment: MPESA_CONFIG.environment,
      configured: !!(MPESA_CONFIG.consumerKey && MPESA_CONFIG.consumerSecret),
      shortCode: MPESA_CONFIG.shortCode,
      baseUrl: MPESA_BASE_URL,
      callbackEndpoint: '/api/mpesa/callback',
      fullCallbackUrl: process.env.MPESA_CALLBACK_URL || `https://backend-payment-cv4c.onrender.com/api/mpesa/callback`
    }
  };

  // Test M-Pesa connectivity
  try {
    if (MPESA_CONFIG.consumerKey && MPESA_CONFIG.consumerSecret) {
      const token = await getMpesaAccessToken();
      health.mpesa.connectivity = 'connected';
      health.mpesa.tokenValid = !!token;
    } else {
      health.mpesa.connectivity = 'not_configured';
    }
  } catch (error) {
    health.mpesa.connectivity = 'error';
    health.mpesa.error = error.message;
  }

  res.json(health);
});

// Test endpoint with callback URL info
app.get('/api/test', (req, res) => {
  const callbackUrl = process.env.MPESA_CALLBACK_URL || 'https://backend-payment-cv4c.onrender.com/api/mpesa/callback';
  
  res.json({ 
    success: true, 
    message: 'API is working!',
    environment: MPESA_CONFIG.environment,
    callbackUrl: callbackUrl,
    note: MPESA_CONFIG.environment === 'production' 
      ? `Using production M-Pesa. Callback URL: ${callbackUrl}` 
      : 'Using sandbox. Test phone: 254708374149, PIN: 4103',
    steps: MPESA_CONFIG.environment === 'production' ? [
      '1. Ensure MPESA_CALLBACK_URL is set in Render',
      '2. Whitelist the URL in Safaricom Daraja portal',
      '3. Test with small amount first'
    ] : []
  });
});

// Test callback endpoint
app.get('/api/mpesa/test-callback', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Callback endpoint is accessible',
    url: req.protocol + '://' + req.get('host') + '/api/mpesa/callback',
    method: 'POST',
    requiredResponse: '{ "ResultCode": 0, "ResultDesc": "Success" }'
  });
});

// Order Management
let orders = [];

app.post('/api/orders', (req, res) => {
  try {
    console.log('📦 Create Order Request:', req.body);
    
    const { items, total, customerInfo, paymentMethod } = req.body;
    
    const order = {
      id: 'ORD-' + Date.now(),
      items,
      total,
      customerInfo,
      paymentMethod,
      status: paymentMethod === 'mpesa' ? 'pending_payment' : 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    orders.push(order);
    console.log('✅ Order created:', order.id);

    res.json({
      success: true,
      order,
      message: 'Order created successfully'
    });
  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order'
    });
  }
});

app.get('/api/orders/:orderId', (req, res) => {
  const order = orders.find(o => o.id === req.params.orderId);
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }
  res.json({ success: true, order });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`🚀 Backend server running on port ${PORT}`);
  console.log(`📱 M-Pesa Environment: ${MPESA_CONFIG.environment}`);
  console.log(`🔗 Test endpoints:`);
  console.log(`   - https://backend-payment-cv4c.onrender.com/api/health`);
  console.log(`   - https://backend-payment-cv4c.onrender.com/api/test`);
  console.log(`   - https://backend-payment-cv4c.onrender.com/api/mpesa/test-callback`);
  console.log(`\n💡 Important:`);
  
  if (MPESA_CONFIG.environment === 'production') {
    console.log(`   ⚠️  USING PRODUCTION CREDENTIALS`);
    console.log(`   ⚠️  Real money will be deducted`);
    console.log(`   ⚠️  Test with small amounts first`);
    console.log(`\n🔗 Callback URL required:`);
    console.log(`   ${process.env.MPESA_CALLBACK_URL || 'https://backend-payment-cv4c.onrender.com/api/mpesa/callback'}`);
    console.log(`\n📋 Steps to fix CallBackURL error:`);
    console.log(`   1. Go to Render dashboard → Environment`);
    console.log(`   2. Set MPESA_CALLBACK_URL to:`);
    console.log(`      https://backend-payment-cv4c.onrender.com/api/mpesa/callback`);
    console.log(`   3. Whitelist in Safaricom Daraja portal`);
  } else {
    console.log(`   🧪 SANDBOX MODE (testing only)`);
    console.log(`   📞 Test phone: 254708374149`);
    console.log(`   🔑 Test PIN: 4103`);
  }
  
  console.log(`========================================\n`);
});
