const ServiceOrder = require('../models/ServiceOrder');
const sendEmail = require('../utils/sendEmail');
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
exports.createNotaryRequest = async (req, res) => {
  try {
    const { formData, price, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    const userId = req.user.id;
    const userEmail = req.user.email;

    if (!verifyPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const newOrder = await ServiceOrder.create({
      userId,
      userEmail,
      serviceType: 'notary-service',
      formData,
      price,
      status: 'processing',
      deliveryMethod: formData.deliveryMethod
    });

    await sendEmail(userEmail, 'Notary Request Received', 'We are processing your notarized document.');
    res.status(201).json({ message: 'Notary service requested', order: newOrder });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong' });
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
exports.createPriorityBooking = async (req, res) => {
  try {
    const { formData, price, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    const userId = req.user.id;
    const userEmail = req.user.email;

    if (!verifyPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const newOrder = await ServiceOrder.create({
      userId,
      userEmail,
      serviceType: 'priority-booking',
      formData,
      price,
      status: 'completed'
    });

    await sendEmail(userEmail, 'Priority Booking Confirmed', 'Your same-day consultation is confirmed.');
    res.status(201).json({ message: 'Priority booking done', order: newOrder });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong' });
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
