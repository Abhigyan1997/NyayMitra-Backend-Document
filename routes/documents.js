const express = require('express');
const router = express.Router();
const controller = require('../controllers/documentController');
const {
  generateAIAffidavit,
  createNotaryBooking,
  updateNotaryStatus,
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
// Route to create a notary booking order
router.post('/create-notary-booking', verifyToken, createNotaryBooking);

// Admin route to update notary status
router.post('/update-notary-status', verifyToken, updateNotaryStatus);


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




router.post('/priority-booking', controller.validatePriorityBooking, controller.createPriorityBooking);
router.get('/priority-booking/:id', controller.getPriorityBookingById);
router.patch('/priority-booking/:id/status', controller.updatePriorityBookingStatus);
router.get('/priority-booking/user/:userId', controller.getUserPriorityBookings);
router.post('/priority-booking/webhook/payment-confirmation', controller.handlePaymentWebhook);



module.exports = router;
