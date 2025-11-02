const User = require('../models/user.model');
const Parking = require('../models/parking.model');
const Booking = require('../models/booking.model');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');

// @desc    Get all users (admin only)
// @route   GET /api/v1/admin/users
// @access  Private/Admin
exports.getAllUsers = catchAsync(async (req, res, next) => {
  const users = await User.find().select('-__v -passwordChangedAt');
  
  res.status(200).json({
    status: 'success',
    results: users.length,
    data: {
      users,
    },
  });
});

// @desc    Get user by ID (admin only)
// @route   GET /api/v1/admin/users/:id
// @access  Private/Admin
exports.getUser = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.id).select('-__v -passwordChangedAt');
  
  if (!user) {
    return next(new AppError('No user found with that ID', 404));
  }
  
  res.status(200).json({
    status: 'success',
    data: {
      user,
    },
  });
});

// @desc    Update user (admin only)
// @route   PATCH /api/v1/admin/users/:id
// @access  Private/Admin
exports.updateUser = catchAsync(async (req, res, next) => {
  // 1) Filter out unwanted fields that are not allowed to be updated
  const filteredBody = filterObj(
    req.body,
    'name',
    'email',
    'phone',
    'role',
    'active'
  );
  
  // 2) Update user document
  const updatedUser = await User.findByIdAndUpdate(
    req.params.id,
    filteredBody,
    {
      new: true,
      runValidators: true,
    }
  );
  
  if (!updatedUser) {
    return next(new AppError('No user found with that ID', 404));
  }
  
  res.status(200).json({
    status: 'success',
    data: {
      user: updatedUser,
    },
  });
});

// @desc    Delete user (admin only)
// @route   DELETE /api/v1/admin/users/:id
// @access  Private/Admin
exports.deleteUser = catchAsync(async (req, res, next) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { active: false },
    { new: true }
  );
  
  if (!user) {
    return next(new AppError('No user found with that ID', 404));
  }
  
  res.status(204).json({
    status: 'success',
    data: null,
  });
});

// @desc    Get all parkings (admin only)
// @route   GET /api/v1/admin/parkings
// @access  Private/Admin
exports.getAllParkings = catchAsync(async (req, res, next) => {
  const features = new APIFeatures(Parking.find(), req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate();
  
  const parkings = await features.query;
  
  res.status(200).json({
    status: 'success',
    results: parkings.length,
    data: {
      parkings,
    },
  });
});

// @desc    Update parking status (admin only)
// @route   PATCH /api/v1/admin/parkings/:id/status
// @access  Private/Admin
exports.updateParkingStatus = catchAsync(async (req, res, next) => {
  const { status } = req.body;
  
  if (!['pending', 'approved', 'rejected', 'suspended'].includes(status)) {
    return next(new AppError('Invalid status value', 400));
  }
  
  const parking = await Parking.findByIdAndUpdate(
    req.params.id,
    { status },
    {
      new: true,
      runValidators: true,
    }
  );
  
  if (!parking) {
    return next(new AppError('No parking found with that ID', 404));
  }
  
  // Notify parking owner about status change
  // await new Email(parking.owner).sendParkingStatusUpdate(status);
  
  res.status(200).json({
    status: 'success',
    data: {
      parking,
    },
  });
});

// @desc    Get all bookings (admin only)
// @route   GET /api/v1/admin/bookings
// @access  Private/Admin
exports.getAllBookings = catchAsync(async (req, res, next) => {
  const features = new APIFeatures(Booking.find(), req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate();
  
  const bookings = await features.query
    .populate('user', 'name email')
    .populate('parking', 'name');
  
  res.status(200).json({
    status: 'success',
    results: bookings.length,
    data: {
      bookings,
    },
  });
});

// @desc    Update booking (admin only)
// @route   PATCH /api/v1/admin/bookings/:id
// @access  Private/Admin
exports.updateBooking = catchAsync(async (req, res, next) => {
  const { status } = req.body;
  
  const booking = await Booking.findById(req.params.id);
  if (!booking) {
    return next(new AppError('No booking found with that ID', 404));
  }
  
  // Update booking status
  booking.status = status;
  booking.updatedAt = Date.now();
  
  // Handle refund if cancelling a paid booking
  if (status === 'cancelled' && booking.payment.status === 'completed') {
    // Implement refund logic here (e.g., call payment provider's refund API)
    // This is a simplified example
    booking.payment.refundStatus = 'pending';
    booking.payment.refundRequestedAt = Date.now();
    
    // In a real app, you would call the payment provider's API here
    // await processRefund(booking.payment.paymentId, booking.amount);
  }
  
  await booking.save();
  
  // Notify user about booking update
  // await new Email(booking.user).sendBookingUpdate(booking);
  
  res.status(200).json({
    status: 'success',
    data: {
      booking,
    },
  });
});

// @desc    Get dashboard stats (admin only)
// @route   GET /api/v1/admin/stats
// @access  Private/Admin
exports.getDashboardStats = catchAsync(async (req, res, next) => {
  const stats = await Promise.all([
    // Total users
    User.countDocuments(),
    
    // Total parkings
    Parking.countDocuments(),
    
    // Total bookings
    Booking.countDocuments(),
    
    // Total revenue (only from completed payments)
    Booking.aggregate([
      {
        $match: { 'payment.status': 'completed' },
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]),
    
    // Bookings by status
    Booking.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]),
    
    // Recent bookings
    Booking.find()
      .sort('-createdAt')
      .limit(5)
      .populate('user', 'name')
      .populate('parking', 'name'),
  ]);
  
  const [
    totalUsers,
    totalParkings,
    totalBookings,
    revenueStats,
    bookingsByStatus,
    recentBookings,
  ] = stats;
  
  res.status(200).json({
    status: 'success',
    data: {
      stats: {
        totalUsers,
        totalParkings,
        totalBookings,
        totalRevenue: revenueStats[0]?.totalRevenue || 0,
        totalTransactions: revenueStats[0]?.count || 0,
        bookingsByStatus: bookingsByStatus.reduce((acc, curr) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {}),
        recentBookings,
      },
    },
  });
});

// Helper function to filter object fields
const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach((el) => {
    if (allowedFields.includes(el)) newObj[el] = obj[el];
  });
  return newObj;
};
