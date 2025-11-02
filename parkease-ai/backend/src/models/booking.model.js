const mongoose = require('mongoose');
const validator = require('validator');

const bookingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: [true, 'Booking must belong to a user'],
    },
    parking: {
      type: mongoose.Schema.ObjectId,
      ref: 'Parking',
      required: [true, 'Booking must belong to a parking'],
    },
    slot: {
      type: mongoose.Schema.ObjectId,
      required: [true, 'Booking must have a slot'],
    },
    slotNumber: {
      type: String,
      required: [true, 'Please provide slot number'],
    },
    startTime: {
      type: Date,
      required: [true, 'Please provide start time'],
    },
    endTime: {
      type: Date,
      required: [true, 'Please provide end time'],
      validate: {
        validator: function (value) {
          return value > this.startTime;
        },
        message: 'End time must be after start time',
      },
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled', 'completed', 'no-show'],
      default: 'pending',
    },
    amount: {
      type: Number,
      required: [true, 'Booking must have an amount'],
      min: [0, 'Amount must be a positive number'],
    },
    payment: {
      method: {
        type: String,
        enum: ['card', 'upi', 'wallet', 'cash'],
        required: [true, 'Please provide payment method'],
      },
      status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded', 'partially_refunded'],
        default: 'pending',
      },
      transactionId: String,
      paymentIntentId: String,
      receiptUrl: String,
    },
    qrCode: String,
    checkInTime: Date,
    checkOutTime: Date,
    cancellation: {
      reason: String,
      cancelledBy: {
        type: String,
        enum: ['user', 'owner', 'system', 'admin'],
      },
      cancelledAt: Date,
      refundAmount: Number,
    },
    vehicle: {
      type: {
        type: String,
        enum: ['car', 'bike', 'truck', 'other'],
        default: 'car',
      },
      number: String,
      make: String,
      model: String,
      color: String,
    },
    notes: String,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
bookingSchema.index({ user: 1 });
bookingSchema.index({ parking: 1 });
bookingSchema.index({ 'payment.status': 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ startTime: 1, endTime: 1 });
bookingSchema.index({ 'vehicle.number': 1 });

// Document middleware
bookingSchema.pre('save', async function (next) {
  // Generate QR code before saving
  if (this.isNew) {
    this.qrCode = `PARK-EASE-${this._id.toString().slice(-8).toUpperCase()}`;
  }
  next();
});

// Query middleware
bookingSchema.pre(/^find/, function (next) {
  this.populate({
    path: 'user',
    select: 'name email phone',
  }).populate({
    path: 'parking',
    select: 'name location address',
  });
  next();
});

// Static method to check if slot is available
bookingSchema.statics.isSlotAvailable = async function (slotId, startTime, endTime, bookingId = null) {
  const query = {
    slot: slotId,
    status: { $in: ['pending', 'confirmed'] },
    $or: [
      { startTime: { $lt: endTime }, endTime: { $gt: startTime } }, // New booking starts in between existing booking
      { startTime: { $gte: startTime, $lt: endTime } }, // Existing booking starts in between new booking
    ],
  };

  if (bookingId) {
    query._id = { $ne: bookingId }; // Exclude current booking when updating
  }

  const bookings = await this.find(query);
  return bookings.length === 0;
};

// Instance method to calculate duration in hours
bookingSchema.methods.calculateDuration = function () {
  const durationMs = this.endTime - this.startTime;
  return Math.ceil(durationMs / (1000 * 60 * 60)); // Convert to hours and round up
};

// Instance method to check if booking can be cancelled
bookingSchema.methods.canBeCancelled = function () {
  const now = new Date();
  const hoursUntilStart = (this.startTime - now) / (1000 * 60 * 60);
  
  // Allow cancellation up to 1 hour before start time
  return this.status === 'confirmed' && hoursUntilStart > 1;
};

const Booking = mongoose.model('Booking', bookingSchema);

module.exports = Booking;
