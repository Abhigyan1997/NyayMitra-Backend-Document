const express = require('express');
const router = express.Router();
const {
  generateAIAffidavit,
  serveInstantDownload,
  createNotaryRequest,
  uploadNotaryScan,
  createPriorityBooking,
  purchaseTemplate,
  generateAiPdf,
  getAllOrders,
  getOrderById,
  getOrdersByUserId,
  updateOrderStatus,
  downloadDocument

} = require('../controllers/documentController');

const verifyToken = require('../middleware/verifyToken');

// 1️⃣ AI Affidavit Assistant
router.post('/ai-affidavit', verifyToken, generateAIAffidavit);

// 2️⃣ Self-Attested Instant Download
router.get('/download', verifyToken, downloadDocument);

// 3️⃣ Remote Notary Request
router.post('/notary-request', verifyToken, createNotaryRequest);
router.put('/notary-upload/:id', uploadNotaryScan); // Admin uploads notarized doc

// 4️⃣ Speed Booking (Priority Flag)
router.post('/priority-booking', verifyToken, createPriorityBooking);

// 5️⃣ Legal Template Store Purchase
router.post('/template-store', verifyToken, purchaseTemplate);

// 6️⃣ AI PDF Generator (free-form)
router.post('/ai-pdf', verifyToken, generateAiPdf);

// 🔍 Admin/User APIs
router.get('/', getAllOrders); // Admin
router.get('/:orderId', getOrderById); // Admin/User
router.get('/user/:userId', getOrdersByUserId); // User
router.patch('/status/:orderId', updateOrderStatus); // Admin or webhook

module.exports = router;
