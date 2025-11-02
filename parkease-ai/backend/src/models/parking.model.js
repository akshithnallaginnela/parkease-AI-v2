const mongoose = require('mongoose');
const slugify = require('slugify');

const parkingSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'A parking must have a name'],
      trim: true,
      maxlength: [100, 'A parking name must have less or equal than 100 characters'],
      minlength: [5, 'A parking name must have more or equal than 5 characters'],
    },
    slug: String,
    description: {
      type: String,
      trim: true,
    },
    owner: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: [true, 'Parking must belong to an owner'],
    },
    location: {
      // GeoJSON Point
      type: {
        type: String,
        default: 'Point',
        enum: ['Point'],
      },
      coordinates: [Number], // [longitude, latitude]
      address: String,
      description: String,
    },
    totalSlots: {
      type: Number,
      required: [true, 'A parking must have a total number of slots'],
      min: [1, 'A parking must have at least 1 slot'],
    },
    availableSlots: {
      type: Number,
      default: 0,
    },
    slots: [
      {
        slotId: {
          type: String,
          required: [true, 'A slot must have an ID'],
        },
        number: {
          type: Number,
          required: [true, 'A slot must have a number'],
        },
        type: {
          type: String,
          enum: ['car', 'bike', 'ev', 'handicap', 'truck'],
          default: 'car',
        },
        status: {
          type: String,
          enum: ['available', 'occupied', 'reserved', 'maintenance'],
          default: 'available',
        },
        pricePerHour: {
          type: Number,
          required: [true, 'A slot must have a price per hour'],
          min: [0, 'Price must be a positive number'],
        },
        features: [String], // e.g., ['covered', 'cctv', 'lighting']
      },
    ],
    images: [String],
    openingHours: {
      monday: { open: String, close: String },
      tuesday: { open: String, close: String },
      wednesday: { open: String, close: String },
      thursday: { open: String, close: String },
      friday: { open: String, close: String },
      saturday: { open: String, close: String },
      sunday: { open: String, close: String },
    },
    is24x7: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    rating: {
      type: Number,
      default: 4.5,
      min: [1, 'Rating must be above 1.0'],
      max: [5, 'Rating must be below 5.0'],
      set: (val) => Math.round(val * 10) / 10, // 4.6666 -> 4.7
    },
    ratingQuantity: {
      type: Number,
      default: 0,
    },
    features: [String], // e.g., ['security', 'valet', 'restroom', 'ev-charging']
    dynamicPricing: {
      isEnabled: {
        type: Boolean,
        default: false,
      },
      rules: [
        {
          name: String,
          condition: String, // e.g., "time > '18:00' && time < '23:59'"
          multiplier: {
            type: Number,
            min: 0.5,
            max: 5,
          },
        },
      ],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
parkingSchema.index({ location: '2dsphere' });
parkingSchema.index({ slug: 1 });

// Virtual populate
parkingSchema.virtual('reviews', {
  ref: 'Review',
  foreignField: 'parking',
  localField: '_id',
});

// Document middleware: runs before .save() and .create()
parkingSchema.pre('save', function (next) {
  this.slug = slugify(this.name, { lower: true });
  this.availableSlots = this.slots.filter(
    (slot) => slot.status === 'available' || slot.status === 'reserved'
  ).length;
  next();
});

// Query middleware
parkingSchema.pre(/^find/, function (next) {
  this.find({ isActive: { $ne: false } });
  next();
});

// Aggregation middleware
parkingSchema.pre('aggregate', function (next) {
  this.pipeline().unshift({ $match: { isActive: { $ne: false } } });
  next();
});

// Static method to get available slots count
parkingSchema.statics.calcAvailableSlots = async function (parkingId) {
  const stats = await this.aggregate([
    {
      $match: { _id: parkingId },
    },
    {
      $project: {
        availableSlots: {
          $size: {
            $filter: {
              input: '$slots',
              as: 'slot',
              cond: { $eq: ['$$slot.status', 'available'] },
            },
          },
        },
      },
    },
  ]);

  if (stats.length > 0) {
    await this.findByIdAndUpdate(parkingId, {
      availableSlots: stats[0].availableSlots,
    });
  }
};

// Call calcAvailableSlots after save and remove
parkingSchema.post('save', function () {
  this.constructor.calcAvailableSlots(this._id);
});

const Parking = mongoose.model('Parking', parkingSchema);

module.exports = Parking;
