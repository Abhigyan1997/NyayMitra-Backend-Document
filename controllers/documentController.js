const ServiceOrder = require('../models/ServiceOrder');
const sendEmail = require('../utils/sendEmail');
const razorpay = require('../config/razorpay');
const { v4: uuidv4 } = require('uuid');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');


// Razorpay Signature Verification
const verifyPayment = (orderId, paymentId, signature) => {
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return expectedSignature === signature;
};

// const razorpay = new Razorpay({
//   key_id: process.env.RAZORPAY_KEY_ID,
//   key_secret: process.env.RAZORPAY_SECRET
// });


// controllers/documentController.js


exports.downloadDocument = async (req, res) => {
  const { documentId, userId } = req.query;

  if (!documentId || !userId) {
    return res.status(400).json({ message: "Missing documentId or userId" });
  }

  try {
    const order = await ServiceOrder.findById(documentId);
    if (!order || order.userId !== userId) {
      return res.status(403).json({ message: "Unauthorized access" });
    }

    if (order.status !== 'completed') {
      return res.status(400).json({ message: "Payment not completed" });
    }

    const fileNameMap = {
      'complaint': 'police-complaint.html',
      'affidavit': 'genral-affidavit.html',
      'agreement': 'two-party-agreement.html'
    };

    const fileName = fileNameMap[order.documentType];
    if (!fileName) {
      return res.status(404).json({ message: "Template not found" });
    }

    const filePath = path.join(__dirname, '..', 'public', 'templates', fileName);
    order.downloadCount += 1;
    await order.save();

    return res.download(filePath, `${order.documentType}-template.html`);
  } catch (err) {
    console.error("Download error", err);
    return res.status(500).json({ message: "Failed to download document" });
  }
};


// 1️⃣ AI Affidavit Assistant
exports.generateAIAffidavit = async (req, res) => {
  try {
    const { formData, price, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    const userId = req.user.id;
    const userEmail = req.user.email;

    if (!verifyPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const doc = new PDFDocument();
    const filePath = path.join(__dirname, `../generated/affidavit_${Date.now()}.pdf`);
    doc.pipe(fs.createWriteStream(filePath));
    doc.fontSize(16).text(`AFFIDAVIT\n\nName: ${formData.name}\nFacts: ${formData.facts}\nAgainst: ${formData.against}\nLocation: ${formData.location}`);
    doc.end();

    const newOrder = await ServiceOrder.create({
      userId,
      userEmail,
      serviceType: 'ai-affidavit',
      formData,
      price,
      status: 'completed',
      documentUrl: filePath
    });

    await sendEmail(userEmail, 'Your Affidavit is Ready', 'Please find attached affidavit.', [{ path: filePath }]);
    res.status(201).json({ message: 'Affidavit generated', order: newOrder });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong' });
  }
};

// 2️⃣ Self-Attested Instant Download
exports.serveInstantDownload = async (req, res) => {
  try {
    const { formData, price, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    const userId = req.user.id;
    const userEmail = req.user.email;

    if (!verifyPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const templatePath = path.join(__dirname, '../templates/rent_agreement_template.pdf');

    const newOrder = await ServiceOrder.create({
      userId,
      userEmail,
      serviceType: 'self-attested',
      formData,
      price,
      status: 'completed',
      documentUrl: templatePath
    });

    await sendEmail(userEmail, 'Download Your Document', 'Here is your rent agreement.', [{ path: templatePath }]);
    res.download(templatePath);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong' });
  }
};

// 3️⃣ Notary Service
// Create Notary Booking
exports.createNotaryBooking = async (req, res) => {
  try {
    const {
      userId,
      userEmail,
      name,
      phone,
      documentType,
      stampValue,
      documentDescription,
      deliveryAddress,
      specialInstructions,
      serviceType, // 'digital' or 'physical'
      requiresRegistration
    } = req.body;

    if (!userId || !userEmail || !name || !phone || !documentType || !stampValue || !documentDescription) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const baseFee = serviceType === 'digital' ? 39900 : 79900; // in paise
    const stampDuty = stampValue * 100;
    const registrationFee = requiresRegistration ? 100000 : 0;
    const totalAmount = baseFee + stampDuty + registrationFee;

    const razorpayOrder = await razorpay.orders.create({
      amount: totalAmount,
      currency: 'INR',
      receipt: `notary_${Date.now()}`,
      notes: {
        serviceType: 'notary',
        notaryType: serviceType,
        documentType,
        customerName: name
      }
    });

    const notaryOrder = new ServiceOrder({
      userId,
      userEmail,
      serviceType: 'notary',
      serviceName: `${serviceType} notarization`,
      documentType,
      price: totalAmount / 100,
      finalAmount: totalAmount / 100,
      currency: 'INR',
      status: 'pending',
      deliveryMethod: serviceType === 'digital' ? 'email' : 'courier',
      notaryType: serviceType,
      stampValue,
      requiresRegistration,
      registrationFee: registrationFee / 100,
      documentDescription,
      deliveryAddress: serviceType === 'physical' ? deliveryAddress : undefined,
      specialInstructions,
      metadata: {
        customerName: name,
        customerPhone: phone
      },
      razorpayOrderId: razorpayOrder.id
    });

    await notaryOrder.save();

    res.json({
      success: true,
      orderId: razorpayOrder.id,
      serviceOrderId: notaryOrder._id,
      amount: totalAmount,
      currency: 'INR',
      key: process.env.RAZORPAY_KEY
    });
  } catch (error) {
    console.error('Notary booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create notary booking',
      error: error.message
    });
  }
};

// Update Notary Status
exports.updateNotaryStatus = async (req, res) => {
  try {
    const { orderId, status, notaryId, rejectionReason } = req.body;

    const order = await ServiceOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const validTransitions = {
      'pending': ['assigned', 'rejected'],
      'assigned': ['in-progress', 'rejected'],
      'in-progress': ['completed', 'rejected'],
      'rejected': [],
      'completed': []
    };

    if (!validTransitions[order.notaryStatus]?.includes(status)) {
      return res.status(400).json({ message: "Invalid status transition" });
    }

    order.notaryStatus = status;

    if (status === 'assigned') {
      order.notaryId = notaryId;
      order.notaryAssignedAt = new Date();
    } else if (status === 'completed') {
      order.notaryCompletedAt = new Date();
      order.updateStatus('completed', 'Notarization completed');
    } else if (status === 'rejected') {
      order.updateStatus('failed', rejectionReason || 'Notarization rejected');
    }

    await order.save();

    res.json({
      success: true,
      message: `Notary status updated to ${status}`,
      order
    });

  } catch (error) {
    console.error('Status update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update notary status',
      error: error.message
    });
  }
};


// 4️⃣ Notary Scan Upload
exports.uploadNotaryScan = async (req, res) => {
  try {
    const { id } = req.params;
    const { documentUrl } = req.body;

    const order = await ServiceOrder.findByIdAndUpdate(id, {
      documentUrl,
      status: 'completed',
      deliveryDate: new Date()
    }, { new: true });

    if (order) {
      await sendEmail(order.userEmail, 'Notarized Document Ready', 'Please find your notarized document.', [{ path: documentUrl }]);
      res.json({ message: 'Notarized document uploaded', order });
    } else {
      res.status(404).json({ message: 'Order not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong' });
  }
};

// 5️⃣ Priority Booking


// Middleware validation (exportable if needed elsewhere)
exports.validatePriorityBooking = (req, res, next) => {
  const requiredFields = ['userId', 'userEmail', 'name', 'phone', 'issueType', 'preferredDate', 'preferredTime', 'description', 'urgency'];
  const missing = requiredFields.filter(f => !req.body[f]);
  if (missing.length > 0) return res.status(400).json({ success: false, message: `Missing fields: ${missing.join(', ')}` });

  const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
  if (!emailRegex.test(req.body.userEmail)) return res.status(400).json({ success: false, message: 'Invalid email' });

  const phoneRegex = /^[6-9]\d{9}$/;
  if (!phoneRegex.test(req.body.phone.replace(/\D/g, ''))) return res.status(400).json({ success: false, message: 'Invalid phone number' });

  next();
};

// Create booking
exports.createPriorityBooking = async (req, res) => {
  try {
    // console.log("📥 Incoming priority booking request with body:", req.body);

    const {
      userId, userEmail, name, phone, issueType,
      preferredDate, preferredTime, description,
      urgency, ipAddress, userAgent, metadata
    } = req.body;

    const basePrice = 99, priorityFee = 99;
    const totalAmount = basePrice + priorityFee;
    // console.log("💰 Calculated totalAmount:", totalAmount);

    const newOrder = new ServiceOrder({
      userId,
      userEmail,
      serviceType: 'legal-consultation',
      serviceName: 'Priority Legal Consultation',
      documentType: 'other',
      price: basePrice,
      discountApplied: 0,
      finalAmount: totalAmount,
      status: 'pending',
      statusHistory: [{
        status: 'pending',
        changedAt: new Date(),
        reason: 'Order created'
      }],
      deliveryMethod: 'email',
      deliveryStatus: 'pending',
      documentDescription: description,
      specialInstructions: `Urgency: ${urgency}\nIssue Type: ${issueType}\nPreferred Time: ${preferredDate} ${preferredTime}`,
      metadata: {
        ...metadata,
        priorityBooking: true,
        clientName: name,
        clientPhone: phone,
        issueType,
        preferredDate,
        preferredTime,
        urgency
      },
      ipAddress,
      userAgent
    });

    // console.log("📦 Created new ServiceOrder object:", newOrder);

    const shortReceipt = `rcpt_${Date.now()}`;
    // console.log("🧾 Generated Razorpay receipt ID:", shortReceipt);

    const razorpayOrder = await razorpay.orders.create({
      amount: totalAmount * 100,
      currency: "INR",
      receipt: shortReceipt,
      payment_capture: 1
    });

    // console.log("✅ Razorpay order created:", razorpayOrder);

    newOrder.razorpayOrderId = razorpayOrder.id;

    const savedOrder = await newOrder.save();
    // console.log("💾 Saved new order to DB:", savedOrder._id);

    res.status(201).json({
      success: true,
      message: 'Priority booking created successfully',
      data: {
        order: savedOrder,
        payment: {
          amount: totalAmount,
          currency: 'INR',
          razorpayOrderId: razorpayOrder.id,
          key: process.env.RAZORPAY_KEY
        }
      }
    });

  } catch (err) {
    console.error("❌ Create Booking Error:", err.message);
    console.error(err.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking',
      error: err.message
    });
  }
};


// Get booking by ID
exports.getPriorityBookingById = async (req, res) => {
  try {
    const order = await ServiceOrder.findOne({ _id: req.params.id, serviceName: 'Priority Legal Consultation' });
    if (!order) return res.status(404).json({ success: false, message: 'Booking not found' });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching booking', error: err.message });
  }
};

// Update status
exports.updatePriorityBookingStatus = async (req, res) => {
  try {
    const { status, reason } = req.body;
    const valid = ['pending', 'processing', 'completed', 'failed', 'refunded'];
    if (!valid.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });

    const order = await ServiceOrder.findById(req.params.id);
    if (!order || order.serviceName !== 'Priority Legal Consultation') {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    order.updateStatus(status, reason || 'Updated via API');
    await order.save();

    res.json({ success: true, message: 'Status updated', data: order });

  } catch (err) {
    res.status(500).json({ success: false, message: 'Error updating status', error: err.message });
  }
};

// Get all bookings by user
exports.getUserPriorityBookings = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      ServiceOrder.find({ userId: req.params.userId, serviceName: 'Priority Legal Consultation' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      ServiceOrder.countDocuments({ userId: req.params.userId, serviceName: 'Priority Legal Consultation' })
    ]);

    res.json({
      success: true,
      data: orders,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) }
    });

  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching user bookings', error: err.message });
  }
};

// Razorpay webhook handler
exports.handlePaymentWebhook = async (req, res) => {
  try {
    const { order_id, payment_id, status } = req.body;
    const order = await ServiceOrder.findOne({ razorpayOrderId: order_id });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    order.razorpayPaymentId = payment_id;
    order.paymentAt = new Date();

    if (status === 'captured') {
      order.status = 'processing';
      order.statusHistory.push({ status: 'processing', changedAt: new Date(), reason: 'Payment captured' });
    } else {
      order.status = 'failed';
      order.statusHistory.push({ status: 'failed', changedAt: new Date(), reason: `Payment status: ${status}` });
    }

    await order.save();
    res.json({ success: true, message: 'Order status updated' });

  } catch (err) {
    res.status(500).json({ success: false, message: 'Webhook error', error: err.message });
  }
};


// 6️⃣ Legal Template Store Purchase
exports.purchaseTemplate = async (req, res) => {
  try {
    const { formData, price, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    const userId = req.user.id;
    const userEmail = req.user.email;

    if (!verifyPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const filePath = path.join(__dirname, `../templates/${formData.templateId}.pdf`);

    const newOrder = await ServiceOrder.create({
      userId,
      userEmail,
      serviceType: 'template-store',
      formData,
      price,
      status: 'completed',
      documentUrl: filePath
    });

    await sendEmail(userEmail, 'Your Template Purchase', 'Here is your legal template.', [{ path: filePath }]);
    res.download(filePath);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong' });
  }
};

// 7️⃣ AI PDF Generator
exports.generateAiPdf = async (req, res) => {
  try {
    const { formData, price, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    const userId = req.user.id;
    const userEmail = req.user.email;

    if (!verifyPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const doc = new PDFDocument();
    const filePath = path.join(__dirname, `../generated/pdf_${Date.now()}.pdf`);
    doc.pipe(fs.createWriteStream(filePath));
    doc.fontSize(16).text(`Legal Document:\n\n${formData.prompt}`);
    doc.end();

    const newOrder = await ServiceOrder.create({
      userId,
      userEmail,
      serviceType: 'ai-pdf-generator',
      formData,
      price,
      status: 'completed',
      documentUrl: filePath
    });

    await sendEmail(userEmail, 'AI Generated PDF', 'Your AI document is ready.', [{ path: filePath }]);
    res.status(201).json({ message: 'PDF created', order: newOrder });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong' });
  }
};

// 🔍 Get Orders
exports.getAllOrders = async (req, res) => {
  const orders = await ServiceOrder.find().sort({ createdAt: -1 });
  res.json(orders);
};

exports.getOrderById = async (req, res) => {
  const order = await ServiceOrder.findById(req.params.orderId);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json(order);
};

exports.getOrdersByUserId = async (req, res) => {
  const orders = await ServiceOrder.find({ userId: req.params.userId });
  res.json(orders);
};

exports.updateOrderStatus = async (req, res) => {
  const { orderId } = req.params;
  const update = req.body;
  const order = await ServiceOrder.findByIdAndUpdate(orderId, update, { new: true });
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json(order);
};
