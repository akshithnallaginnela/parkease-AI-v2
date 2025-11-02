const express = require('express');
const parkingController = require('../controllers/parking.controller');
const bookingController = require('../controllers/booking.controller');
const reviewController = require('../controllers/review.controller');
const { catchAsync } = require('../utils/catchAsync');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const { uploadParkingImages, resizeParkingImages } = require('../middleware/upload.middleware');

const router = express.Router();

// Public routes
router.get('/', catchAsync(parkingController.getAllParkings));
router.get('/stats', catchAsync(parkingController.getParkingStats));
router.get('/:id', catchAsync(parkingController.getParking));
router.get('/:id/slots', catchAsync(parkingController.getParkingSlots));
router.get('/:id/availability', catchAsync(parkingController.getParkingAvailability));

// Protected routes (require authentication)
router.use(catchAsync(protect));

// Nested routes for reviews
router.get('/:parkingId/reviews', catchAsync(reviewController.getAllReviews));
router.post(
  '/:parkingId/reviews',
  restrictTo('user'),
  catchAsync(reviewController.createReview)
);

// Nested routes for bookings
router.get('/:parkingId/bookings', catchAsync(bookingController.getAllBookings));
router.post(
  '/:parkingId/bookings',
  restrictTo('user'),
  catchAsync(bookingController.createBooking)
);

// Routes that require authentication and specific roles
router.use(restrictTo('owner', 'admin'));

// Parking management routes
router.post(
  '/',
  uploadParkingImages,
  resizeParkingImages,
  catchAsync(parkingController.createParking)
);

router.patch(
  '/:id',
  uploadParkingImages,
  resizeParkingImages,
  catchAsync(parkingController.updateParking)
);

router.delete('/:id', catchAsync(parkingController.deleteParking));

// Owner dashboard routes
router.get(
  '/my-parkings',
  restrictTo('owner'),
  catchAsync(parkingController.getMyParkings)
);

// Admin dashboard routes
router.get(
  '/owner/:ownerId',
  restrictTo('admin'),
  catchAsync(parkingController.getParkingsByOwner)
);

module.exports = router;
