const { Server } = require('socket.io');
const { getRedisClient } = require('../config/redis');
const logger = require('./logger');

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Socket.io connection handler
  io.on('connection', (socket) => {
    logger.info(`New client connected: ${socket.id}`);

    // Join parking room for real-time updates
    socket.on('join-parking', async (parkingId) => {
      if (parkingId) {
        await socket.join(`parking-${parkingId}`);
        logger.info(`Socket ${socket.id} joined parking-${parkingId}`);
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      logger.info(`Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

// Function to emit events to specific parking room
const emitToParking = (parkingId, event, data) => {
  if (!io) {
    logger.error('Socket.io not initialized');
    return;
  }
  io.to(`parking-${parkingId}`).emit(event, data);
};

// Function to emit events to specific user
const emitToUser = (userId, event, data) => {
  if (!io) {
    logger.error('Socket.io not initialized');
    return;
  }
  io.to(`user-${userId}`).emit(event, data);
};

// Function to handle real-time parking updates
const updateParkingAvailability = async (parkingId) => {
  try {
    const redisClient = await getRedisClient();
    if (redisClient) {
      const cacheKey = `parking:${parkingId}:availability`;
      const parking = await Parking.findById(parkingId).select('slots');
      
      if (parking) {
        const availableSlots = parking.slots.filter(
          (slot) => slot.status === 'available' || slot.status === 'reserved'
        ).length;

        const data = {
          parkingId,
          availableSlots,
          totalSlots: parking.slots.length,
          updatedAt: new Date(),
        };

        // Cache the data
        await redisClient.set(cacheKey, JSON.stringify(data), 'EX', 60); // Cache for 1 minute
        
        // Emit update to all connected clients
        emitToParking(parkingId, 'parking:availability', data);
      }
    }
  } catch (error) {
    logger.error(`Error updating parking availability: ${error.message}`);
  }
};

// Function to handle booking updates
const notifyBookingUpdate = (booking) => {
  if (!io) return;
  
  // Notify the user who made the booking
  emitToUser(booking.user.toString(), 'booking:updated', {
    bookingId: booking._id,
    status: booking.status,
    updatedAt: booking.updatedAt,
  });

  // Notify parking owner
  emitToUser(booking.parking.owner.toString(), 'booking:updated', {
    bookingId: booking._id,
    status: booking.status,
    parkingId: booking.parking._id,
    updatedAt: booking.updatedAt,
  });

  // Update parking availability
  updateParkingAvailability(booking.parking._id);
};

// Function to handle new review notifications
const notifyNewReview = (review) => {
  if (!io) return;
  
  // Notify parking owner
  emitToUser(review.parking.owner.toString(), 'review:new', {
    reviewId: review._id,
    parkingId: review.parking._id,
    rating: review.rating,
    comment: review.review,
    createdAt: review.createdAt,
  });
};

module.exports = {
  initSocket,
  emitToParking,
  emitToUser,
  updateParkingAvailability,
  notifyBookingUpdate,
  notifyNewReview,
  getIO: () => io,
};
