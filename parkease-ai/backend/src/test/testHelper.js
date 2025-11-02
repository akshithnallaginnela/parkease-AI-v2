const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../../app');
const User = require('../models/user.model');
const Parking = require('../models/parking.model');
const Booking = require('../models/booking.model');

// Helper to create a test user
const createTestUser = async (userData = {}) => {
  const user = new User({
    name: 'Test User',
    email: 'test@example.com',
    password: 'test1234',
    passwordConfirm: 'test1234',
    phone: '1234567890',
    role: 'user',
    ...userData,
  });
  
  // Hash password
  await user.save({ validateBeforeSave: false });
  return user;
};

// Helper to create a test parking
const createTestParking = async (ownerId, parkingData = {}) => {
  const parking = new Parking({
    name: 'Test Parking',
    description: 'A test parking space',
    owner: ownerId,
    location: {
      type: 'Point',
      coordinates: [77.5946, 12.9716], // Bangalore coordinates
      address: 'Test Address',
    },
    totalSlots: 10,
    slots: Array(10).fill(0).map((_, i) => ({
      slotId: `slot-${i + 1}`,
      number: i + 1,
      type: 'car',
      status: 'available',
      pricePerHour: 50,
    })),
    is24x7: true,
    ...parkingData,
  });
  
  await parking.save();
  return parking;
};

// Helper to create a test booking
const createTestBooking = async (userId, parkingId, slotId, bookingData = {}) => {
  const booking = new Booking({
    user: userId,
    parking: parkingId,
    slot: slotId,
    slotNumber: 'A1',
    startTime: new Date(),
    endTime: new Date(Date.now() + 3600000), // 1 hour later
    status: 'confirmed',
    amount: 100,
    payment: {
      method: 'card',
      status: 'completed',
      transactionId: 'txn_test_' + Math.random().toString(36).substring(7),
    },
    ...bookingData,
  });
  
  await booking.save();
  return booking;
};

// Helper to get auth headers for authenticated requests
const getAuthHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
});

// Helper to make authenticated requests
const api = {
  get: (url, token) => 
    request(app)
      .get(url)
      .set('Accept', 'application/json')
      .set(token ? getAuthHeaders(token) : {}),
      
  post: (url, data, token) => 
    request(app)
      .post(url)
      .set('Accept', 'application/json')
      .set(token ? getAuthHeaders(token) : {})
      .send(data),
      
  patch: (url, data, token) => 
    request(app)
      .patch(url)
      .set('Accept', 'application/json')
      .set(token ? getAuthHeaders(token) : {})
      .send(data),
      
  delete: (url, token) => 
    request(app)
      .delete(url)
      .set('Accept', 'application/json')
      .set(token ? getAuthHeaders(token) : {}),
};

module.exports = {
  createTestUser,
  createTestParking,
  createTestBooking,
  getAuthHeaders,
  api,
};
