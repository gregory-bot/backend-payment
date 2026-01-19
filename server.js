/* ======================================================
   🔧 Environment & Dependencies
   ====================================================== */
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

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
   📧 Email Service Configuration
   ====================================================== */
// Email configuration
const EMAIL_CONFIG = {
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
};

// Create transporter
let transporter;
try {
  if (process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
    transporter = nodemailer.createTransport({
      service: EMAIL_CONFIG.service,
      auth: EMAIL_CONFIG.auth,
    });

    // Verify email configuration
    transporter.verify((error, success) => {
      if (error) {
        console.error('❌ Email configuration error:', error.message);
      } else {
        console.log('✅ Email server is ready to send messages');
      }
    });
  } else {
    console.log('⚠️ Email credentials not configured. Email service disabled.');
  }
} catch (error) {
  console.error('❌ Email transporter creation failed:', error.message);
}

/**
 * Send order confirmation email
 */
async function sendOrderConfirmationEmail(order) {
  try {
    if (!transporter) {
      console.log('📧 Email service not available');
      return false;
    }

    if (!order.customerInfo?.email) {
      console.log('📧 No email provided for order, skipping email');
      return false;
    }

    const orderIdShort = order.id.slice(-8).toUpperCase();
    const totalAmount = order.total.toLocaleString();
    const itemsList = order.items.map(item => 
      `• ${item.name} (${item.brand}) - ${item.quantity} x KSh ${item.price.toLocaleString()} = KSh ${(item.price * item.quantity).toLocaleString()}`
    ).join('\n');

    const mailOptions = {
      from: process.env.EMAIL_FROM || `"Gadgets by Crestrock" <${process.env.EMAIL_USER}>`,
      to: order.customerInfo.email,
      subject: `🎉 Order Confirmation - #${orderIdShort}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .order-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 12px; }
            .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-weight: bold; }
            .status-paid { background: #d1fae5; color: #065f46; }
            .button { display: inline-block; background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">Order Confirmed! 🎉</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">Thank you for your purchase</p>
            </div>
            
            <div class="content">
              <p>Hello <strong>${order.customerInfo.name}</strong>,</p>
              <p>Your order has been confirmed and payment received successfully!</p>
              
              <div class="order-details">
                <h3 style="margin-top: 0;">Order Summary</h3>
                <div style="margin-bottom: 15px;">
                  <span class="status-badge status-paid">PAID</span>
                  <strong>Order ID:</strong> #${orderIdShort}
                </div>
                
                <table style="width: 100%; border-collapse: collapse;">
                  <thead style="background: #f3f4f6;">
                    <tr>
                      <th style="text-align: left; padding: 10px; border-bottom: 1px solid #e5e7eb;">Item</th>
                      <th style="text-align: right; padding: 10px; border-bottom: 1px solid #e5e7eb;">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${order.items.map(item => `
                      <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">
                          <strong>${item.name}</strong><br>
                          <small>${item.brand} • Qty: ${item.quantity}</small>
                        </td>
                        <td style="text-align: right; padding: 10px; border-bottom: 1px solid #e5e7eb;">
                          KSh ${(item.price * item.quantity).toLocaleString()}
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                  <tfoot style="background: #f3f4f6;">
                    <tr>
                      <td style="padding: 10px; font-weight: bold;">Total Amount</td>
                      <td style="text-align: right; padding: 10px; font-weight: bold; font-size: 18px;">
                        KSh ${totalAmount}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              
              <div style="margin: 20px 0;">
                <h4>Delivery Information</h4>
                <p>
                  <strong>Delivery Address:</strong> ${order.customerInfo.deliveryAddress}<br>
                  <strong>Phone:</strong> ${order.customerInfo.phone}<br>
                  <strong>Order Date:</strong> ${new Date(order.createdAt).toLocaleString()}
                </p>
              </div>
              
              ${order.mpesaData?.receiptNumber ? `
              <div style="background: #d1fae5; padding: 15px; border-radius: 6px; margin: 20px 0;">
                <h4 style="margin-top: 0; color: #065f46;">Payment Details</h4>
                <p style="margin: 5px 0;"><strong>M-Pesa Receipt:</strong> ${order.mpesaData.receiptNumber}</p>
                <p style="margin: 5px 0;"><strong>Amount Paid:</strong> KSh ${order.mpesaData.amount?.toLocaleString() || totalAmount}</p>
                <p style="margin: 5px 0;"><strong>Payment Time:</strong> ${new Date(order.updatedAt).toLocaleString()}</p>
              </div>
              ` : ''}
              
              <div style="margin: 25px 0; text-align: center;">
                <a href="${process.env.FRONTEND_URL || 'https://shop.gadgets.crestrock.ltd'}/order-confirmation/${order.id}" class="button">
                  View Order Status
                </a>
              </div>
              
              <p>We'll contact you shortly to confirm delivery details. Delivery typically takes 24-48 hours.</p>
              
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <h4>Need Help?</h4>
                <p>
                  📞 Call us: <a href="tel:+254742312545" style="color: #10b981;">+254 742 312 545</a><br>
                  💬 WhatsApp: <a href="https://wa.me/254742312545" style="color: #10b981;">+254 742 312 545</a><br>
                  📧 Email: <a href="mailto:support@gadgets.crestrock.ltd" style="color: #10b981;">support@gadgets.crestrock.ltd</a>
                </p>
              </div>
            </div>
            
            <div class="footer">
              <p>© ${new Date().getFullYear()} Gadgets by Crestrock. All rights reserved.</p>
              <p>This email was sent automatically. Please do not reply to this email.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
Order Confirmation - #${orderIdShort}

Hello ${order.customerInfo.name},

Your order has been confirmed and payment received successfully!

ORDER SUMMARY:
Order ID: #${orderIdShort}
Status: PAID
Order Date: ${new Date(order.createdAt).toLocaleString()}

ITEMS:
${itemsList}

TOTAL: KSh ${totalAmount}

DELIVERY INFORMATION:
Name: ${order.customerInfo.name}
Address: ${order.customerInfo.deliveryAddress}
Phone: ${order.customerInfo.phone}

${order.mpesaData?.receiptNumber ? `
PAYMENT DETAILS:
M-Pesa Receipt: ${order.mpesaData.receiptNumber}
Amount Paid: KSh ${order.mpesaData.amount?.toLocaleString() || totalAmount}
Payment Time: ${new Date(order.updatedAt).toLocaleString()}
` : ''}

We'll contact you shortly to confirm delivery details. Delivery typically takes 24-48 hours.

NEED HELP?
📞 Call: +254 742 312 545
💬 WhatsApp: +254 742 312 545
📧 Email: support@gadgets.crestrock.ltd

View your order: ${process.env.FRONTEND_URL || 'https://shop.gadgets.crestrock.ltd'}/order-confirmation/${order.id}

© ${new Date().getFullYear()} Gadgets by Crestrock
      `
    };

    console.log(`📧 Sending confirmation email to: ${order.customerInfo.email}`);
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully:', info.messageId);
    
    return true;
  } catch (error) {
    console.error('❌ Error sending email:', error.message);
    return false;
  }
}

/**
 * Send order notification email to admin
 */
async function sendAdminNotificationEmail(order) {
  try {
    if (!transporter) {
      console.log('📧 Email service not available');
      return false;
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      console.log('📧 No admin email configured');
      return false;
    }

    const orderIdShort = order.id.slice(-8).toUpperCase();
    const totalAmount = order.total.toLocaleString();

    const mailOptions = {
      from: process.env.EMAIL_FROM || `"Gadgets by Crestrock" <${process.env.EMAIL_USER}>`,
      to: adminEmail,
      subject: `🛒 New Order Received - #${orderIdShort}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; }
            .header { background: #1e40af; color: white; padding: 20px; }
            .content { background: #f3f4f6; padding: 20px; }
            .order-info { background: white; padding: 15px; margin: 10px 0; border-radius: 5px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>🛒 New Order Received</h2>
            </div>
            <div class="content">
              <div class="order-info">
                <h3>Order #${orderIdShort}</h3>
                <p><strong>Customer:</strong> ${order.customerInfo.name}</p>
                <p><strong>Phone:</strong> ${order.customerInfo.phone}</p>
                <p><strong>Email:</strong> ${order.customerInfo.email || 'Not provided'}</p>
                <p><strong>Amount:</strong> KSh ${totalAmount}</p>
                <p><strong>Delivery Address:</strong> ${order.customerInfo.deliveryAddress}</p>
                <p><strong>Payment Method:</strong> ${order.paymentMethod}</p>
                ${order.mpesaData?.receiptNumber ? 
                  `<p><strong>M-Pesa Receipt:</strong> ${order.mpesaData.receiptNumber}</p>` : ''}
              </div>
              <p><a href="${process.env.ADMIN_URL || process.env.FRONTEND_URL || 'https://shop.gadgets.crestrock.ltd'}/admin/orders/${order.id}">View Order in Admin Panel</a></p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    console.log(`📧 Sending admin notification to: ${adminEmail}`);
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('❌ Error sending admin email:', error.message);
    return false;
  }
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
    if (mpesaData) {
      // Merge mpesaData instead of replacing
      const orderSnapshot = await db.ref(`orders/${orderId}`).once('value');
      const currentOrder = orderSnapshot.val();
      updates.mpesaData = { ...(currentOrder.mpesaData || {}), ...mpesaData };
    }
    
    await db.ref(`orders/${orderId}`).update(updates);
    console.log(`✅ Order ${orderId} updated to status: ${status}`);
    
    // Return updated order
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

// 1. Health Check (Updated with email status)
app.get('/api/health', (req, res) => {
  console.log('🏥 Health check from:', req.headers.origin || 'Unknown');
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Gadgets by Crestrock API',
    firebase: db ? 'Connected' : 'Disconnected',
    mpesa: MPESA_CONFIG.consumerKey ? 'Configured' : 'Not configured',
    email: transporter ? 'Configured' : 'Not configured',
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
   📞 M-Pesa Callback Endpoint (Updated with Email)
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
      
      // ✅ SEND EMAIL TO CUSTOMER
      try {
        const emailSent = await sendOrderConfirmationEmail(updatedOrder);
        if (emailSent) {
          console.log('📧 Confirmation email sent to customer');
          
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
        console.error('📧 Email sending failed:', emailError.message);
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
   📧 Test Email Endpoint
   ====================================================== */
app.post('/api/test-email', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email address is required' 
      });
    }

    if (!transporter) {
      return res.status(500).json({
        success: false,
        message: 'Email service not configured'
      });
    }

    const testMailOptions = {
      from: process.env.EMAIL_FROM || `"Gadgets by Crestrock" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: '✅ Test Email from Gadgets by Crestrock',
      text: 'This is a test email to confirm your email configuration is working correctly.',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2 style="color: #10b981;">✅ Test Email Successful!</h2>
          <p>Your email configuration is working correctly.</p>
          <p>You will receive order confirmation emails at this address.</p>
        </div>
      `
    };

    await transporter.sendMail(testMailOptions);
    
    res.json({
      success: true,
      message: 'Test email sent successfully'
    });
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test email',
      error: error.message
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
  console.log(`📧 Email: ${transporter ? 'Configured' : 'Not configured'}`);
});
