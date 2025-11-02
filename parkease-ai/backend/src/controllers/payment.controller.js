const crypto = require('crypto');
const { promisify } = require('util');
const Booking = require('../models/booking.model');
const Parking = require('../models/parking.model');
const User = require('../models/user.model');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');
const { getRedisClient } = require('../config/redis');

// Initialize Razorpay (example with Razorpay, but similar for Stripe)
const Razorpay = require('razorpay');
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// @desc    Create payment order
// @route   POST /api/v1/payments/create-order
// @access  Private
exports.createPaymentOrder = catchAsync(async (req, res, next) => {
  const { bookingId, amount, currency = 'INR' } = req.body;

  // 1) Get booking and verify
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    return next(new AppError('No booking found with that ID', 404));
  }

  // 2) Verify booking belongs to user or user is admin
  if (
    booking.user.toString() !== req.user.id &&
    req.user.role !== 'admin'
  ) {
    return next(
      new AppError('You are not authorized to pay for this booking', 403)
    );
  }

  // 3) Verify booking status
  if (booking.status !== 'pending') {
    return next(
      new AppError('This booking has already been paid for or cancelled', 400)
    );
  }

  // 4) Create order in Razorpay
  const options = {
    amount: amount * 100, // Razorpay expects amount in paise
    currency,
    receipt: `booking_${booking._id}`,
    payment_capture: 1, // Auto capture payment
    notes: {
      bookingId: booking._id.toString(),
      userId: req.user.id,
    },
  };

  try {
    const order = await razorpay.orders.create(options);

    // 5) Update booking with payment details
    booking.payment = {
      orderId: order.id,
      status: 'pending',
      amount: amount,
      currency,
    };
    await booking.save();

    // 6) Send order details to client
    res.status(200).json({
      status: 'success',
      data: {
        order,
      },
    });
  } catch (err) {
    logger.error(`Razorpay order creation error: ${err.message}`);
    return next(
      new AppError('Error creating payment order. Please try again.', 500)
    );
  }
});

// @desc    Verify payment and confirm booking
// @route   POST /api/v1/payments/verify
// @access  Private
exports.verifyPayment = catchAsync(async (req, res, next) => {
  const { orderId, paymentId, signature, bookingId } = req.body;

  // 1) Get booking
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    return next(new AppError('No booking found with that ID', 404));
  }

  // 2) Verify booking belongs to user or user is admin
  if (
    booking.user.toString() !== req.user.id &&
    req.user.role !== 'admin'
  ) {
    return next(
      new AppError('You are not authorized to verify this payment', 403)
    );
  }

  // 3) Verify payment with Razorpay
  const text = orderId + '|' + paymentId;
  const generatedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(text)
    .digest('hex');

  if (generatedSignature !== signature) {
    return next(new AppError('Invalid payment signature', 400));
  }

  // 4) Update booking status
  booking.status = 'confirmed';
  booking.payment.status = 'completed';
  booking.payment.paymentId = paymentId;
  booking.payment.paidAt = Date.now();
  await booking.save();

  // 5) Update parking slot status
  await Parking.updateOne(
    { 'slots._id': booking.slot },
    { $set: { 'slots.$.status': 'reserved' } }
  );

  // 6) Invalidate cache
  const redisClient = getRedisClient();
  if (redisClient) {
    try {
      await redisClient.del(`parking:${booking.parking}:availability`);
    } catch (error) {
      logger.error(`Redis error: ${error.message}`);
    }
  }

  // 7) Send confirmation email (implement email service)
  // await new Email(user, booking).sendBookingConfirmation();

  res.status(200).json({
    status: 'success',
    message: 'Payment verified and booking confirmed',
    data: {
      booking,
    },
  });
});

// @desc    Webhook for payment notifications
// @route   POST /api/v1/payments/webhook
// @access  Public (called by Razorpay)
exports.webhook = catchAsync(async (req, res, next) => {
  const signature = req.headers['x-razorpay-signature'];
  const body = req.body;

  // Verify webhook signature
  const text = JSON.stringify(body);
  const generatedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(text)
    .digest('hex');

  if (generatedSignature !== signature) {
    return res.status(400).json({ status: 'error', message: 'Invalid signature' });
  }

  const { event, payload } = body;

  // Handle different webhook events
  switch (event) {
    case 'payment.captured':
      // Handle successful payment
      await handleSuccessfulPayment(payload.payment.entity);
      break;
    case 'payment.failed':
      // Handle failed payment
      await handleFailedPayment(payload.payment.entity);
      break;
    case 'refund.processed':
      // Handle refund
      await handleRefund(payload.refund.entity);
      break;
    default:
      logger.info(`Unhandled webhook event: ${event}`);
  }

  res.status(200).json({ status: 'success' });
});

// Helper functions for webhook handlers
const handleSuccessfulPayment = async (payment) => {
  try {
    const booking = await Booking.findOneAndUpdate(
      { 'payment.orderId': payment.order_id },
      {
        'payment.status': 'completed',
        'payment.paymentId': payment.id,
        'payment.paidAt': new Date(payment.created_at * 1000),
        status: 'confirmed',
      },
      { new: true, runValidators: true }
    );

    if (booking) {
      // Update parking slot status
      await Parking.updateOne(
        { 'slots._id': booking.slot },
        { $set: { 'slots.$.status': 'reserved' } }
      );

      // Invalidate cache
      const redisClient = getRedisClient();
      if (redisClient) {
        await redisClient.del(`parking:${booking.parking}:availability`);
      }

      // Send confirmation email
      const user = await User.findById(booking.user);
      // await new Email(user, booking).sendBookingConfirmation();
    }
  } catch (error) {
    logger.error(`Error handling successful payment: ${error.message}`);
  }
};

const handleFailedPayment = async (payment) => {
  try {
    await Booking.findOneAndUpdate(
      { 'payment.orderId': payment.order_id },
      {
        'payment.status': 'failed',
        'payment.failedAt': new Date(payment.created_at * 1000),
        'payment.error': payment.error_description || 'Payment failed',
        status: 'cancelled',
      }
    );
  } catch (error) {
    logger.error(`Error handling failed payment: ${error.message}`);
  }
};

const handleRefund = async (refund) => {
  try {
    const booking = await Booking.findOneAndUpdate(
      { 'payment.paymentId': refund.payment_id },
      {
        'payment.refundId': refund.id,
        'payment.refundStatus': refund.status,
        'payment.refundedAt': new Date(refund.created_at * 1000),
        status: 'refunded',
      },
      { new: true, runValidators: true }
    );

    if (booking) {
      // Update parking slot status back to available
      await Parking.updateOne(
        { 'slots._id': booking.slot },
        { $set: { 'slots.$.status': 'available' } }
      );

      // Invalidate cache
      const redisClient = getRedisClient();
      if (redisClient) {
        await redisClient.del(`parking:${booking.parking}:availability`);
      }
    }
  } catch (error) {
    logger.error(`Error handling refund: ${error.message}`);
  }
};
