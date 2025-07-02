const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const ServiceOrder = require('../models/ServiceOrder');

const router = express.Router();

const razorpay = new Razorpay({
    key_id: "rzp_test_sOYYnrVHAv2xsi",
    key_secret: "HwBLGsCvsk1D9H5m0rX1dGkK",
});

// Create Razorpay Order and ServiceOrder entry
router.post('/create-order', async (req, res) => {
    try {
        const { userId, userEmail, serviceName, documentType, price } = req.body;

        if (!userId || !userEmail || !serviceName || !documentType || !price) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        const order = await razorpay.orders.create({
            amount: price * 100, // in paise
            currency: 'INR',
            receipt: `receipt_${Date.now()}`,
        });

        const newOrder = new ServiceOrder({
            userId,
            userEmail,
            serviceType: 'document-download',
            serviceName,
            documentType,
            price,
            finalAmount: price,
            razorpayOrderId: order.id,
            status: 'pending',
            deliveryMethod: 'download'
        });

        await newOrder.save();

        res.json({ ...order, orderRecordId: newOrder._id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error creating order" });
    }
});
router.post('/verify', async (req, res) => {
    const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        documentId, // this is ServiceOrder._id
    } = req.body;
    if (!process.env.RAZORPAY_SECRET) {
        throw new Error("RAZORPAY_SECRET is not defined in environment variables");
    }


    try {
        const body = `${razorpay_order_id}|${razorpay_payment_id}`;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_SECRET)
            .update(body)
            .digest("hex");

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ message: "Invalid signature" });
        }

        const order = await ServiceOrder.findById(documentId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        order.razorpayPaymentId = razorpay_payment_id;
        order.razorpaySignature = razorpay_signature;
        order.paymentAt = new Date();
        order.updateStatus('completed', 'Payment verified');

        await order.save();

        res.json({ message: "Payment verified successfully" });
    } catch (err) {
        console.error("Verification failed", err);
        res.status(500).json({ message: "Verification failed" });
    }
});


module.exports = router;