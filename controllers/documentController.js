const ServiceOrder = require('../models/ServiceOrder');
const sendEmail = require('../utils/sendEmail');
const razorpay = require('../config/razorpay');
const PDFDocument = require('pdfkit');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');


// Razorpay Signature Verification
const verifyPayment = (orderId, paymentId, signature) => {
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return expectedSignature === signature;
};

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


// Document Review Controller Methods
exports.submitDocumentReview = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      documentType,
      documentPurpose,
      specificQuestions,
      urgency
    } = req.body;

    // Validate required fields
    if (!req.file) {
      return res.status(400).json({ error: 'Document file is required' });
    }

    // Validate document type against enum values
    const validDocumentTypes = [
      'agreement', 'affidavit', 'complaint', 'contract',
      'power_of_attorney', 'education_gap_affidavit',
      'indemnity_bond', 'legal_heir_certificate',
      'court_evidence_affidavit', 'other',
      'rent_agreement', 'bussiness_agreement',
      'legal_notice', 'will_testament'
    ];

    if (!validDocumentTypes.includes(documentType)) {
      return res.status(400).json({
        error: 'Invalid document type',
        validTypes: validDocumentTypes
      });
    }

    // Calculate price based on urgency
    const urgencyPrices = {
      '24': 999,
      '48': 799,
      '72': 599,
      '168': 499
    };

    const price = urgencyPrices[urgency] || 499;

    // Create order with all required fields
    const order = new ServiceOrder({
      userId: req.user.id,
      userEmail: email,
      userName: name,
      userPhone: phone,
      serviceType: 'document-review',
      serviceName: 'Document Review',
      documentType,
      price,
      finalAmount: price,
      currency: 'INR',
      status: 'pending',
      deliveryMethod: 'email',
      documentUrl: `/uploads/documents/${req.file.filename}`,
      metadata: {
        documentPurpose,
        specificQuestions,
        urgencyHours: parseInt(urgency),
        originalFilename: req.file.originalname
      },
      // Additional fields for tracking
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    await order.save();

    res.status(201).json({
      success: true,
      orderId: order._id,
      estimatedCompletion: new Date(Date.now() + parseInt(urgency) * 60 * 60 * 1000).toISOString(),
      amount: price,
      currency: 'INR'
    });

  } catch (error) {
    console.error('Document review submission error:', error);

    // Handle specific mongoose validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        error: 'Validation failed',
        details: errors
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
};

exports.getDocumentReview = async (req, res) => {
  try {
    const order = await ServiceOrder.findOne({
      _id: req.params.orderId,
      serviceType: 'document-review'
    });

    if (!order) {
      return res.status(404).json({ error: 'Review not found' });
    }

    // Check if user is authorized to view this review
    if (order.userId !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    res.json(order);

  } catch (error) {
    console.error('Get document review error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateReviewStatus = async (req, res) => {
  try {
    const { status, feedback, reviewedDocumentUrl } = req.body;

    const order = await ServiceOrder.findOneAndUpdate(
      {
        _id: req.params.orderId,
        serviceType: 'document-review'
      },
      {
        status,
        'metadata.feedback': feedback,
        'metadata.reviewedDocumentUrl': reviewedDocumentUrl,
        $push: {
          statusHistory: {
            status: status,
            changedAt: new Date(),
            reason: 'Status updated by admin'
          }
        }
      },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ error: 'Review not found' });
    }

    res.json(order);

  } catch (error) {
    console.error('Update review status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getUserDocumentReviews = async (req, res) => {
  try {
    const reviews = await ServiceOrder.find({
      userId: req.params.userId,
      serviceType: 'document-review'
    }).sort({ createdAt: -1 });

    res.json(reviews);
  } catch (error) {
    console.error('Get user document reviews error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};