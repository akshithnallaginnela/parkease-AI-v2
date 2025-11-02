const express = require('express');
const adminController = require('../controllers/admin.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const { catchAsync } = require('../utils/catchAsync');

const router = express.Router();

// Protect all routes after this middleware (require authentication)
router.use(catchAsync(protect));

// Restrict all routes to admin only
router.use(restrictTo('admin'));

// User management routes
router
  .route('/users')
  .get(catchAsync(adminController.getAllUsers));

router
  .route('/users/:id')
  .get(catchAsync(adminController.getUser))
  .patch(catchAsync(adminController.updateUser))
  .delete(catchAsync(adminController.deleteUser));

// Parking management routes
router
  .route('/parkings')
  .get(catchAsync(adminController.getAllParkings));

router
  .route('/parkings/:id/status')
  .patch(catchAsync(adminController.updateParkingStatus));

// Booking management routes
router
  .route('/bookings')
  .get(catchAsync(adminController.getAllBookings));

router
  .route('/bookings/:id')
  .patch(catchAsync(adminController.updateBooking));

// Dashboard stats
router
  .route('/stats')
  .get(catchAsync(adminController.getDashboardStats));

module.exports = router;
