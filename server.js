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
   📧 EmailJS Configuration
   ====================================================== */
// EmailJS configuration
const EMAILJS_CONFIG = {
  serviceId: process.env.EMAILJS_SERVICE_ID,
  templateId: process.env.EMAILJS_TEMPLATE_ID || 'order_confirmation',
  userId: process.env.EMAILJS_USER_ID, // Public Key
  accessToken: process.env.EMAILJS_ACCESS_TOKEN, // Optional for private templates
};

console.log('📧 EmailJS Config:', {
  hasServiceId: !!EMAILJS_CONFIG.serviceId,
  hasUserId: !!EMAILJS_CONFIG.userId,
  hasTemplateId: !!EMAILJS_CONFIG.templateId,
});

/**
 * Send order confirmation email via EmailJS
 */
async function sendOrderConfirmationEmail(order) {
  try {
    if (!order.customerInfo?.email) {
      console.log('📧 No email provided for order, skipping email');
      return false;
    }

    // Check if EmailJS is configured
    if (!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.userId) {
      console.log('📧 EmailJS not configured');
      return false;
    }

    const orderIdShort = order.id.slice(-8).toUpperCase();
    const totalAmount = order.total.toLocaleString();
    
    // Create HTML for items list
    const itemsListHTML = order.items.map(item => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">
          <strong>${item.name}</strong><br>
          <small>${item.brand} • Qty: ${item.quantity}</small>
        </td>
        <td style="text-align: right; padding: 10px; border-bottom: 1px solid #e5e7eb;">
          KSh ${(item.price * item.quantity).toLocaleString()}
        </td>
      </tr>
    `).join('');

    const emailData = {
      to_email: order.customerInfo.email,
      customer_name: order.customerInfo.name,
      order_id: orderIdShort,
      items_list: itemsListHTML,
      total_amount: totalAmount,
      delivery_address: order.customerInfo.deliveryAddress,
      phone: order.customerInfo.phone,
      order_date: new Date(order.createdAt).toLocaleString(),
      receipt_number: order.mpesaData?.receiptNumber || '',
      amount_paid: (order.mpesaData?.amount || order.total).toLocaleString(),
      payment_time: new Date(order.updatedAt).toLocaleString(),
      order_link: `${process.env.FRONTEND_URL || 'https://shop.gadgets.crestrock.ltd'}/order-confirmation/${order.id}`,
      current_year: new Date().getFullYear().toString(),
    };

    console.log(`📧 Sending EmailJS request to: ${order.customerInfo.email}`);
    
    // EmailJS API endpoint
    const response = await axios.post(
      'https://api.emailjs.com/api/v1.0/email/send',
      {
        service_id: EMAILJS_CONFIG.serviceId,
        template_id: EMAILJS_CONFIG.templateId,
        user_id: EMAILJS_CONFIG.userId,
        accessToken: EMAILJS_CONFIG.accessToken,
        template_params: emailData,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    console.log('✅ EmailJS response status:', response.status);
    console.log('📧 Email sent successfully via EmailJS');
    return true;
    
  } catch (error) {
    console.error('❌ EmailJS error:', error.message);
    if (error.response) {
      console.error('EmailJS response data:', error.response.data);
      console.error('EmailJS status:', error.response.status);
    }
    return false;
  }
}

/**
 * Send admin notification email
 */
async function sendAdminNotificationEmail(order) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      console.log('📧 No admin email configured');
      return false;
    }

    if (!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.userId) {
      console.log('📧 EmailJS not configured');
      return false;
    }

    const orderIdShort = order.id.slice(-8).toUpperCase();
    const totalAmount = order.total.toLocaleString();

    const emailData = {
      to_email: adminEmail,
      customer_name: order.customerInfo.name,
      order_id: orderIdShort,
      phone: order.customerInfo.phone,
      email: order.customerInfo.email || 'Not provided',
      total_amount: totalAmount,
      delivery_address: order.customerInfo.deliveryAddress,
      payment_method: order.paymentMethod,
      receipt_number: order.mpesaData?.receiptNumber || 'N/A',
      order_date: new Date(order.createdAt).toLocaleString(),
      current_year: new Date().getFullYear().toString(),
    };

    const response = await axios.post(
      'https://api.emailjs.com/api/v1.0/email/send',
      {
        service_id: EMAILJS_CONFIG.serviceId,
        template_id: process.env.EMAILJS_ADMIN_TEMPLATE_ID || EMAILJS_CONFIG.templateId,
        user_id: EMAILJS_CONFIG.userId,
        accessToken: EMAILJS_CONFIG.accessToken,
        template_params: emailData,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    console.log('✅ Admin notification sent via EmailJS');
    return true;
    
  } catch (error) {
    console.error('❌ Admin email error:', error.message);
    return false;
  }
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
    if (mpesaData) {
      // Merge mpesaData instead of replacing
      const orderSnapshot = await db.ref(`orders/${orderId}`).once('value');
      const currentOrder = orderSnapshot.val();
      updates.mpesaData = { ...(currentOrder.mpesaData || {}), ...mpesaData };
    }
    
    await db.ref(`orders/${orderId}`).update(updates);
    console.log(`✅ Order ${orderId} updated to status: ${status}`);
    
    // Return updated order for email sending
    const updatedOrder = await getOrderById(orderId);
    return updatedOrder;
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
   📢 Notification System
   ====================================================== */
async function createNotification(message, type, orderId = null, details = null) {
  try {
    const notificationRef = db.ref('notifications').push();
    const notification = {
      id: notificationRef.key,
      message: message,
      type: type,
      orderId: orderId,
      details: details,
      read: false,
      time: new Date().toISOString()
    };
    await notificationRef.set(notification);
    console.log('📢 Notification created:', message);
    return notification;
  } catch (error) {
    console.error('❌ Error creating notification:', error.message);
  }
}

/* ======================================================
   📍 API Endpoints
   ====================================================== */

// 1. Health Check (Updated with EmailJS status)
app.get('/api/health', (req, res) => {
  console.log('🏥 Health check from:', req.headers.origin || 'Unknown');
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Gadgets by Crestrock API',
    firebase: db ? 'Connected' : 'Disconnected',
    mpesa: MPESA_CONFIG.consumerKey ? 'Configured' : 'Not configured',
    emailjs: EMAILJS_CONFIG.serviceId && EMAILJS_CONFIG.userId ? 'Configured' : 'Not configured',
    cors: 'enabled',
    endpoints: [
      'GET /api/health',
      'POST /api/orders',
      'GET /api/orders/:id',
      'POST /api/mpesa/stk-push',
      'POST /api/mpesa/callback',
      'POST /api/test-email'
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
    
    // Create notification for new order
    await createNotification(
      `🛒 New order #${order.id.slice(-8)} from ${customerInfo.name} (KSh ${total.toLocaleString()})`,
      'info',
      order.id,
      {
        customerName: customerInfo.name,
        phone: formattedPhone,
        amount: total,
        items: items.map(item => item.name).join(', ')
      }
    );
    
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

    // Create notification for STK push
    await createNotification(
      `📱 STK Push sent to ${phone} for Order #${orderId.slice(-8)} (KSh ${amount})`,
      'info',
      orderId,
      {
        customerName: order.customerInfo?.name,
        phone: phone,
        amount: amount,
        orderId: orderId
      }
    );

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
    
    // Create notification for failed STK push
    const order = await getOrderById(req.body.orderId);
    if (order) {
      await createNotification(
        `❌ STK Push failed for Order #${req.body.orderId?.slice(-8)}: ${error.message}`,
        'error',
        req.body.orderId,
        {
          customerName: order.customerInfo?.name,
          phone: req.body.phoneNumber,
          amount: req.body.amount,
          error: error.message
        }
      );
    }
    
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to initiate STK Push',
      error: process.env.NODE_ENV === 'development' ? error.response?.data : undefined
    });
  }
});

/* ======================================================
   📞 M-Pesa Callback Endpoint (Updated with EmailJS)
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
      
      const updatedOrder = await updateOrderStatus(orderId, 'paid', {
        receiptNumber,
        amount,
        phoneNumber,
        completedAt: new Date().toISOString(),
        mpesaCallback: req.body
      });
      
      // ✅ SEND EMAIL TO CUSTOMER VIA EMAILJS
      try {
        const emailSent = await sendOrderConfirmationEmail(updatedOrder);
        if (emailSent) {
          console.log('📧 Confirmation email sent to customer via EmailJS');
          
          // Update notification with email status
          await createNotification(
            `📧 Confirmation email sent to ${order.customerInfo?.email} for Order #${orderId.slice(-8)}`,
            'info',
            orderId,
            {
              customerName: order.customerInfo?.name,
              email: order.customerInfo?.email,
              orderId: orderId
            }
          );
        }
      } catch (emailError) {
        console.error('📧 EmailJS sending failed:', emailError.message);
        // Don't fail the whole process if email fails
      }
      
      // ✅ SEND EMAIL TO ADMIN (Optional)
      try {
        await sendAdminNotificationEmail(updatedOrder);
      } catch (adminEmailError) {
        console.error('📧 Admin email sending failed:', adminEmailError.message);
      }
      
      // Create detailed notification for admin
      await createNotification(
        `💰 Payment of KSh ${amount} received for Order #${orderId.slice(-8)} from ${order.customerInfo?.name}. Receipt: ${receiptNumber}`,
        'success',
        orderId,
        {
          customerName: order.customerInfo?.name,
          phone: phoneNumber,
          amount: amount,
          receiptNumber: receiptNumber,
          emailSent: !!order.customerInfo?.email,
          items: order.items?.map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            total: item.price * item.quantity
          })),
          totalOrderAmount: order.total,
          deliveryAddress: order.customerInfo?.deliveryAddress
        }
      );
      
      console.log(`✅ Payment recorded. Receipt: ${receiptNumber}, Amount: ${amount}`);
    } else {
      // Payment failed
      console.log('❌ Payment failed for order:', orderId, 'Reason:', ResultDesc);
      
      await updateOrderStatus(orderId, 'payment_failed', { 
        reason: ResultDesc,
        failedAt: new Date().toISOString(),
        mpesaCallback: req.body
      });
      
      // Create notification for failed payment
      await createNotification(
        `❌ Payment failed for Order #${orderId.slice(-8)}: ${ResultDesc}`,
        'error',
        orderId,
        {
          customerName: order.customerInfo?.name,
          phone: order.customerInfo?.phone,
          amount: order.total,
          reason: ResultDesc
        }
      );
    }

    res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (error) {
    console.error('❌ Callback processing error:', error.message);
    console.error('Stack:', error.stack);
    res.json({ ResultCode: 1, ResultDesc: 'Callback processing failed' });
  }
});

/* ======================================================
   📧 Test Email Endpoint - EMAILJS VERSION
   ====================================================== */
app.post('/api/test-email', async (req, res) => {
  try {
    const { email, name } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email address is required' 
      });
    }

    if (!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.userId) {
      return res.status(500).json({
        success: false,
        message: 'EmailJS not configured'
      });
    }

    // Create test order data
    const orderIdShort = 'TEST-12345';
    
    // Create HTML for items list
    const itemsListHTML = `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">
          <strong>Test Product</strong><br>
          <small>Test Brand • Qty: 1</small>
        </td>
        <td style="text-align: right; padding: 10px; border-bottom: 1px solid #e5e7eb;">
          KSh 1
        </td>
      </tr>
    `;

    const testEmailData = {
      to_email: email,
      customer_name: name || 'Test Customer',
      order_id: orderIdShort,
      items_list: itemsListHTML,
      total_amount: '1',
      delivery_address: 'Test Address, Nairobi',
      phone: '254712345678',
      order_date: new Date().toLocaleString(),
      receipt_number: 'TEST123456',
      amount_paid: '1',
      payment_time: new Date().toLocaleString(),
      order_link: `${process.env.FRONTEND_URL || 'https://shop.gadgets.crestrock.ltd'}/order-confirmation/test`,
      current_year: new Date().getFullYear().toString(),
    };

    console.log(`📧 Sending test email via EmailJS to: ${email}`);
    
    const response = await axios.post(
      'https://api.emailjs.com/api/v1.0/email/send',
      {
        service_id: EMAILJS_CONFIG.serviceId,
        template_id: EMAILJS_CONFIG.templateId,
        user_id: EMAILJS_CONFIG.userId,
        accessToken: EMAILJS_CONFIG.accessToken,
        template_params: testEmailData,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    console.log('✅ Test email sent via EmailJS, status:', response.status);
    
    res.json({
      success: true,
      message: 'Test email sent successfully via EmailJS',
      status: response.status,
    });
  } catch (error) {
    console.error('Test email error:', error.message);
    if (error.response) {
      console.error('EmailJS response data:', error.response.data);
      console.error('EmailJS status:', error.response.status);
    }
    res.status(500).json({
      success: false,
      message: 'Failed to send test email',
      error: error.message,
    });
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
      'POST /api/mpesa/callback',
      'POST /api/test-email'
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
  console.log(`📧 EmailJS: ${EMAILJS_CONFIG.serviceId && EMAILJS_CONFIG.userId ? 'Configured' : 'Not configured'}`);
});
