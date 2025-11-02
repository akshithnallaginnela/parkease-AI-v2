const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../app');
const Booking = require('../src/models/booking.model');
const Parking = require('../src/models/parking.model');
const User = require('../src/models/user.model');
const { createTestUser, createTestParking, api } = require('../src/test/testHelper');

describe('Booking API', () => {
  let testUser;
  let testToken;
  let testParking;
  let testSlotId;
  let testAdminToken;

  beforeAll(async () => {
    // Create test user and get auth token
    testUser = await createTestUser({ role: 'user' });
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'test@example.com',
        password: 'test1234',
      });
    testToken = loginRes.body.token;

    // Create a test parking with available slots
    testParking = await createTestParking(
      new mongoose.Types.ObjectId(), // Different owner
      {
        name: 'Test Parking for Booking',
        slots: [
          { slotId: 'slot-1', number: 1, type: 'car', status: 'available', pricePerHour: 50 },
          { slotId: 'slot-2', number: 2, type: 'car', status: 'available', pricePerHour: 50 },
          { slotId: 'slot-3', number: 3, type: 'bike', status: 'available', pricePerHour: 30 },
        ]
      }
    );
    testSlotId = testParking.slots[0]._id;

    // Create admin user for admin endpoints
    const admin = await createTestUser({ 
      email: 'admin@example.com',
      role: 'admin' 
    });
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'test1234' });
    testAdminToken = adminLogin.body.token;
  });

  describe('POST /api/v1/bookings', () => {
    it('should create a new booking with valid data', async () => {
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour later
      
      const bookingData = {
        parking: testParking._id,
        slot: testSlotId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        vehicle: {
          type: 'car',
          number: 'KA01AB1234',
          make: 'Test',
          model: 'Car',
          color: 'Blue'
        }
      };

      const res = await api.post(
        '/api/v1/bookings',
        bookingData,
        testToken
      );

      expect(res.statusCode).toEqual(201);
      expect(res.body.status).toEqual('success');
      expect(res.body.data.booking).toHaveProperty('_id');
      expect(res.body.data.booking.status).toEqual('pending');
      expect(res.body.data.booking.user).toEqual(testUser._id.toString());
      expect(res.body.data.booking.parking).toEqual(testParking._id.toString());
      expect(res.body.data.booking.slot).toEqual(testSlotId.toString());

      // Verify slot status is updated to reserved
      const updatedParking = await Parking.findById(testParking._id);
      const slot = updatedParking.slots.id(testSlotId);
      expect(slot.status).toEqual('reserved');
    });

    it('should return 400 if slot is already booked', async () => {
      // First booking
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
      
      await api.post(
        '/api/v1/bookings',
        {
          parking: testParking._id,
          slot: testSlotId,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          vehicle: { type: 'car', number: 'KA01AB1234' }
        },
        testToken
      );

      // Try to book the same slot again
      const res = await api.post(
        '/api/v1/bookings',
        {
          parking: testParking._id,
          slot: testSlotId,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          vehicle: { type: 'car', number: 'KA01AB5678' }
        },
        testToken
      );

      expect(res.statusCode).toEqual(400);
      expect(res.body.status).toEqual('fail');
      expect(res.body.message).toMatch(/slot is already booked/i);
    });
  });

  describe('GET /api/v1/bookings', () => {
    it('should get all bookings for the authenticated user', async () => {
      // Create a test booking
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
      
      await Booking.create({
        user: testUser._id,
        parking: testParking._id,
        slot: testSlotId,
        slotNumber: 'A1',
        startTime,
        endTime,
        status: 'confirmed',
        amount: 50,
        payment: {
          method: 'card',
          status: 'completed',
          transactionId: 'txn_test_' + Math.random().toString(36).substring(7),
        },
        vehicle: {
          type: 'car',
          number: 'KA01AB1234'
        }
      });

      const res = await api.get(
        '/api/v1/bookings',
        null,
        testToken
      );

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('success');
      expect(Array.isArray(res.body.data.bookings)).toBeTruthy();
      expect(res.body.results).toBeGreaterThan(0);
      expect(res.body.data.bookings[0].user._id).toEqual(testUser._id.toString());
    });
  });

  describe('GET /api/v1/bookings/:id', () => {
    it('should get a single booking by ID', async () => {
      // Create a test booking
      const booking = await Booking.create({
        user: testUser._id,
        parking: testParking._id,
        slot: testSlotId,
        slotNumber: 'A1',
        startTime: new Date(),
        endTime: new Date(Date.now() + 60 * 60 * 1000),
        status: 'confirmed',
        amount: 50,
        payment: {
          method: 'card',
          status: 'completed',
          transactionId: 'txn_test_' + Math.random().toString(36).substring(7),
        },
        vehicle: {
          type: 'car',
          number: 'KA01AB1234'
        }
      });

      const res = await api.get(
        `/api/v1/bookings/${booking._id}`,
        null,
        testToken
      );

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('success');
      expect(res.body.data.booking._id).toEqual(booking._id.toString());
    });

    it('should return 404 for non-existent booking', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const res = await api.get(
        `/api/v1/bookings/${nonExistentId}`,
        null,
        testToken
      );

      expect(res.statusCode).toEqual(404);
      expect(res.body.status).toEqual('fail');
    });
  });

  describe('PATCH /api/v1/bookings/:id/cancel', () => {
    it('should cancel a booking', async () => {
      // Create a test booking
      const booking = await Booking.create({
        user: testUser._id,
        parking: testParking._id,
        slot: testSlotId,
        slotNumber: 'A1',
        startTime: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours from now
        endTime: new Date(Date.now() + 3 * 60 * 60 * 1000),   // 3 hours from now
        status: 'confirmed',
        amount: 50,
        payment: {
          method: 'card',
          status: 'completed',
          transactionId: 'txn_test_' + Math.random().toString(36).substring(7),
        },
        vehicle: {
          type: 'car',
          number: 'KA01AB1234'
        }
      });

      const res = await api.patch(
        `/api/v1/bookings/${booking._id}/cancel`,
        {},
        testToken
      );

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('success');
      expect(res.body.data.booking.status).toEqual('cancelled');

      // Verify slot status is updated to available
      const updatedParking = await Parking.findById(testParking._id);
      const slot = updatedParking.slots.id(testSlotId);
      expect(slot.status).toEqual('available');
    });
  });

  describe('Admin Endpoints', () => {
    it('should get all bookings (admin only)', async () => {
      const res = await api.get(
        '/api/v1/admin/bookings',
        null,
        testAdminToken
      );

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('success');
      expect(Array.isArray(res.body.data.bookings)).toBeTruthy();
    });

    it('should update booking status (admin only)', async () => {
      // Create a test booking
      const booking = await Booking.create({
        user: testUser._id,
        parking: testParking._id,
        slot: testSlotId,
        slotNumber: 'A1',
        startTime: new Date(),
        endTime: new Date(Date.now() + 60 * 60 * 1000),
        status: 'pending',
        amount: 50,
        payment: {
          method: 'cash',
          status: 'pending'
        },
        vehicle: {
          type: 'car',
          number: 'KA01AB1234'
        }
      });

      const res = await api.patch(
        `/api/v1/admin/bookings/${booking._id}`,
        { status: 'confirmed' },
        testAdminToken
      );

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('success');
      expect(res.body.data.booking.status).toEqual('confirmed');
    });
  });
});
