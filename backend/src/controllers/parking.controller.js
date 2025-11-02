const Parking = require('../models/parking.model');
const Booking = require('../models/booking.model');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const APIFeatures = require('../utils/apiFeatures');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');

// Helper function to get distance from lat/lon using Haversine formula
const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Distance in km
  return distance;
};

const deg2rad = (deg) => {
  return deg * (Math.PI / 180);
};

// @desc    Get all parkings with filtering, sorting, and pagination
// @route   GET /api/v1/parkings
// @access  Public
exports.getAllParkings = catchAsync(async (req, res, next) => {
  // 1) Filtering
  const queryObj = { ...req.query };
  const excludedFields = ['page', 'sort', 'limit', 'fields', 'near'];
  excludedFields.forEach((el) => delete queryObj[el]);

  // 2) Advanced filtering
  let queryStr = JSON.stringify(queryObj);
  queryStr = queryStr.replace(/\b(gte|gt|lte|lt)\b/g, (match) => `$${match}`);

  let query = Parking.find(JSON.parse(queryStr));

  // 3) Sorting
  if (req.query.sort) {
    const sortBy = req.query.sort.split(',').join(' ');
    query = query.sort(sortBy);
  } else {
    query = query.sort('-createdAt');
  }

  // 4) Field limiting
  if (req.query.fields) {
    const fields = req.query.fields.split(',').join(' ');
    query = query.select(fields);
  } else {
    query = query.select('-__v');
  }

  // 5) Pagination
  const page = req.query.page * 1 || 1;
  const limit = req.query.limit * 1 || 100;
  const skip = (page - 1) * limit;

  // 6) Geo-spatial queries (if near parameter is provided)
  if (req.query.near) {
    const [lat, lng, radius = 10] = req.query.near.split(',');
    if (!lat || !lng) {
      return next(
        new AppError(
          'Please provide latitude and longitude in the format lat,lng,radius(km)',
          400
        )
      );
    }

    const radiusInMeters = radius * 1000; // Convert km to meters

    query = query.find({
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)],
          },
          $maxDistance: radiusInMeters,
        },
      },
    });
  }

  // Execute query
  const features = new APIFeatures(Parking.find(), req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate();
  
  const parkings = await features.query;
  const total = await Parking.countDocuments(features.query.getFilter());

  res.status(200).json({
    status: 'success',
    results: parkings.length,
    total,
    data: {
      parkings,
    },
  });
});

// @desc    Get a single parking
// @route   GET /api/v1/parkings/:id
// @access  Public
exports.getParking = catchAsync(async (req, res, next) => {
  const parking = await Parking.findById(req.params.id).populate({
    path: 'reviews',
    select: 'review rating user',
  });

  if (!parking) {
    return next(new AppError('No parking found with that ID', 404));
  }

  // Get available slots count
  const availableSlots = parking.slots.filter(
    (slot) => slot.status === 'available' || slot.status === 'reserved'
  ).length;

  // Get parking statistics (example: average rating, total bookings, etc.)
  const stats = await Booking.aggregate([
    {
      $match: { parking: parking._id },
    },
    {
      $group: {
        _id: '$parking',
        nRatings: { $sum: 1 },
        avgRating: { $avg: '$rating' },
      },
    },
  ]);

  // Get real-time availability from Redis cache if available
  const redisClient = getRedisClient();
  let realTimeAvailability = null;
  
  if (redisClient) {
    try {
      const cacheKey = `parking:${parking._id}:availability`;
      const cachedData = await redisClient.get(cacheKey);
      
      if (cachedData) {
        realTimeAvailability = JSON.parse(cachedData);
      }
    } catch (error) {
      logger.error(`Redis error: ${error.message}`);
    }
  }

  res.status(200).json({
    status: 'success',
    data: {
      parking: {
        ...parking.toObject(),
        availableSlots,
        stats: stats[0] || { nRatings: 0, avgRating: 0 },
        realTimeAvailability,
      },
    },
  });
});

// @desc    Create a new parking
// @route   POST /api/v1/parkings
// @access  Private (Owner/Admin)
exports.createParking = catchAsync(async (req, res, next) => {
  // Only owners and admins can create parkings
  if (req.user.role !== 'admin' && req.user.role !== 'owner') {
    return next(
      new AppError('You do not have permission to create parkings', 403)
    );
  }

  // Set the owner to the current user if not admin
  if (req.user.role === 'owner') {
    req.body.owner = req.user.id;
  }

  // Parse location if provided as string
  if (req.body.location && typeof req.body.location === 'string') {
    try {
      const [lng, lat] = req.body.location.split(',').map(Number);
      if (!isNaN(lat) && !isNaN(lng)) {
        req.body.location = {
          type: 'Point',
          coordinates: [lng, lat],
        };
      }
    } catch (err) {
      return next(new AppError('Invalid location format. Use "lng,lat"', 400));
    }
  }

  // Create parking
  const newParking = await Parking.create(req.body);

  res.status(201).json({
    status: 'success',
    data: {
      parking: newParking,
    },
  });
});

// @desc    Update a parking
// @route   PATCH /api/v1/parkings/:id
// @access  Private (Owner/Admin)
exports.updateParking = catchAsync(async (req, res, next) => {
  // 1) Check if parking exists and user has permission
  const parking = await Parking.findById(req.params.id);
  if (!parking) {
    return next(new AppError('No parking found with that ID', 404));
  }

  // 2) Check if user is the owner or admin
  if (
    req.user.role !== 'admin' &&
    parking.owner.toString() !== req.user.id
  ) {
    return next(
      new AppError('You do not have permission to update this parking', 403)
    );
  }

  // 3) Update parking
  const updatedParking = await Parking.findByIdAndUpdate(
    req.params.id,
    req.body,
    {
      new: true,
      runValidators: true,
    }
  );

  // 4) Invalidate cache if needed
  const redisClient = getRedisClient();
  if (redisClient) {
    try {
      await redisClient.del(`parking:${req.params.id}:availability`);
    } catch (error) {
      logger.error(`Redis error: ${error.message}`);
    }
  }

  res.status(200).json({
    status: 'success',
    data: {
      parking: updatedParking,
    },
  });
});

// @desc    Delete a parking
// @route   DELETE /api/v1/parkings/:id
// @access  Private (Admin/Owner)
exports.deleteParking = catchAsync(async (req, res, next) => {
  // 1) Check if parking exists and user has permission
  const parking = await Parking.findById(req.params.id);
  if (!parking) {
    return next(new AppError('No parking found with that ID', 404));
  }

  // 2) Check if user is the owner or admin
  if (
    req.user.role !== 'admin' &&
    parking.owner.toString() !== req.user.id
  ) {
    return next(
      new AppError('You do not have permission to delete this parking', 403)
    );
  }

  // 3) Soft delete (set isActive to false)
  parking.isActive = false;
  await parking.save({ validateBeforeSave: false });

  // 4) Invalidate cache
  const redisClient = getRedisClient();
  if (redisClient) {
    try {
      await redisClient.del(`parking:${req.params.id}:availability`);
    } catch (error) {
      logger.error(`Redis error: ${error.message}`);
    }
  }

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

// @desc    Get parking statistics
// @route   GET /api/v1/parkings/stats
// @access  Private (Admin/Owner)
exports.getParkingStats = catchAsync(async (req, res, next) => {
  const stats = await Parking.aggregate([
    {
      $match: { isActive: true },
    },
    {
      $group: {
        _id: '$owner',
        nParkings: { $sum: 1 },
        avgRating: { $avg: '$rating' },
        avgPrice: { $avg: '$price' },
        minPrice: { $min: '$price' },
        maxPrice: { $max: '$price' },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'owner',
      },
    },
    {
      $unwind: '$owner',
    },
    {
      $project: {
        _id: 0,
        owner: {
          _id: 1,
          name: 1,
          email: 1,
        },
        nParkings: 1,
        avgRating: 1,
        avgPrice: 1,
        minPrice: 1,
        maxPrice: 1,
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      stats,
    },
  });
});

// @desc    Get parking slots
// @route   GET /api/v1/parkings/:id/slots
// @access  Public
exports.getParkingSlots = catchAsync(async (req, res, next) => {
  const parking = await Parking.findById(req.params.id).select('slots');

  if (!parking) {
    return next(new AppError('No parking found with that ID', 404));
  }

  // Get available slots
  const availableSlots = parking.slots.filter(
    (slot) => slot.status === 'available' || slot.status === 'reserved'
  );

  res.status(200).json({
    status: 'success',
    results: availableSlots.length,
    data: {
      slots: availableSlots,
    },
  });
});

// @desc    Get parking availability
// @route   GET /api/v1/parkings/:id/availability
// @access  Public
exports.getParkingAvailability = catchAsync(async (req, res, next) => {
  const { date, duration = 60 } = req.query; // duration in minutes
  
  const parking = await Parking.findById(req.params.id);
  
  if (!parking) {
    return next(new AppError('No parking found with that ID', 404));
  }

  // Check if parking is open at the requested time
  const requestedDate = date ? new Date(date) : new Date();
  const dayOfWeek = requestedDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  
  if (!parking.is24x7) {
    const openingHours = parking.openingHours[dayOfWeek];
    if (!openingHours || !openingHours.open || !openingHours.close) {
      return res.status(200).json({
        status: 'success',
        data: {
          isOpen: false,
          message: 'Parking is closed on this day',
        },
      });
    }

    const [openHour, openMinute] = openingHours.open.split(':').map(Number);
    const [closeHour, closeMinute] = openingHours.close.split(':').map(Number);
    
    const openTime = new Date(requestedDate);
    openTime.setHours(openHour, openMinute, 0, 0);
    
    const closeTime = new Date(requestedDate);
    closeTime.setHours(closeHour, closeMinute, 0, 0);
    
    const endTime = new Date(requestedDate.getTime() + duration * 60000);
    
    if (requestedDate < openTime || endTime > closeTime) {
      return res.status(200).json({
        status: 'success',
        data: {
          isOpen: false,
          message: 'Parking is closed at the requested time',
          openingHours: {
            [dayOfWeek]: openingHours
          }
        },
      });
    }
  }

  // Get available slots
  const availableSlots = parking.slots.filter(
    (slot) => slot.status === 'available' || slot.status === 'reserved'
  );

  // Check for overlapping bookings
  const overlappingBookings = await Booking.find({
    parking: req.params.id,
    status: { $in: ['confirmed', 'pending'] },
    $or: [
      { startTime: { $lt: new Date(requestedDate.getTime() + duration * 60000) },
        endTime: { $gt: requestedDate } }
    ]
  });

  // Get booked slot IDs
  const bookedSlotIds = overlappingBookings.map(booking => booking.slot.toString());
  
  // Filter out booked slots
  const trulyAvailableSlots = availableSlots.filter(
    slot => !bookedSlotIds.includes(slot._id.toString())
  );

  res.status(200).json({
    status: 'success',
    data: {
      isOpen: true,
      availableSlots: trulyAvailableSlots.length,
      slots: trulyAvailableSlots,
      totalSlots: parking.slots.length,
      lastUpdated: new Date()
    },
  });
});
