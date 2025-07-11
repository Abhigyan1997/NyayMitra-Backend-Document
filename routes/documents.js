const express = require('express');
const router = express.Router();
const controller = require('../controllers/documentController');
const {
  createNotaryBooking,
  updateNotaryStatus,
  getAllOrders,
  getOrderById,
  getOrdersByUserId,
  updateOrderStatus,
  downloadDocument

} = require('../controllers/documentController');
const upload = require('../middleware/uploadMiddleware');
const verifyToken = require('../middleware/verifyToken');


//  Self-Attested Instant Download
router.get('/download', verifyToken, downloadDocument);
// Route to create a notary booking order
router.post('/create-notary-booking', verifyToken, createNotaryBooking);
// Admin route to update notary status
router.post('/update-notary-status', verifyToken, updateNotaryStatus);

router.post('/priority-booking', controller.validatePriorityBooking, controller.createPriorityBooking);

router.get('/priority-booking/:id', controller.getPriorityBookingById);

router.patch('/priority-booking/:id/status', controller.updatePriorityBookingStatus);

router.get('/priority-booking/user/:userId', controller.getUserPriorityBookings);



// 🔍 Admin/User APIs
router.get('/', getAllOrders); // Admin
router.get('/:orderId', getOrderById); // Admin/User
router.get('/user/:userId', getOrdersByUserId); // User
router.patch('/status/:orderId', updateOrderStatus); // Admin or webhook


// Document Review Routes
router.post('/review', verifyToken, upload.single('document'), controller.submitDocumentReview);
router.get('/review/:orderId', verifyToken, controller.getDocumentReview);
router.patch('/review/:orderId/status', verifyToken, controller.updateReviewStatus);
router.get('/review/user/:userId', verifyToken, controller.getUserDocumentReviews);



module.exports = router;
