const express = require('express');
const paymentController = require('../controllers/payment.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const { catchAsync } = require('../utils/catchAsync');

const router = express.Router();

// Protect all routes after this middleware
router.use(catchAsync(protect));

// Create payment order
router.post(
  '/create-order',
  restrictTo('user'),
  catchAsync(paymentController.createPaymentOrder)
);

// Verify payment
router.post(
  '/verify',
  restrictTo('user'),
  catchAsync(paymentController.verifyPayment)
);

// Webhook for payment notifications (no authentication needed)
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }), // Raw body parser for webhook
  catchAsync(paymentController.webhook)
);

// Get payment details
router.get(
  '/:paymentId',
  restrictTo('user', 'admin', 'owner'),
  catchAsync(paymentController.getPayment)
);

// Initiate refund
router.post(
  '/:bookingId/refund',
  restrictTo('admin', 'owner'),
  catchAsync(paymentController.initiateRefund)
);

// Get payment history for a user
router.get(
  '/user/my-payments',
  restrictTo('user'),
  catchAsync(paymentController.getMyPayments)
);

// Get all payments (admin only)
router.get(
  '/',
  restrictTo('admin'),
  catchAsync(paymentController.getAllPayments)
);

module.exports = router;
