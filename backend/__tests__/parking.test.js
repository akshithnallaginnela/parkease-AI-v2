const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../app');
const Parking = require('../src/models/parking.model');
const User = require('../src/models/user.model');
const { createTestUser, createTestParking, api } = require('../src/test/testHelper');

describe('Parking API', () => {
  let testUser;
  let testToken;
  let testParking;

  beforeAll(async () => {
    // Create a test user and get auth token
    testUser = await createTestUser({ role: 'owner' });
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'test@example.com',
        password: 'test1234',
      });
    testToken = loginRes.body.token;

    // Create a test parking
    testParking = await createTestParking(testUser._id);
  });

  describe('GET /api/v1/parkings', () => {
    it('should get all parkings', async () => {
      const res = await api.get('/api/v1/parkings');
      
      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('success');
      expect(Array.isArray(res.body.data.parkings)).toBeTruthy();
      expect(res.body.results).toBeGreaterThan(0);
    });

    it('should filter parkings by location', async () => {
      // Create a parking in a specific location
      await createTestParking(testUser._id, {
        location: {
          type: 'Point',
          coordinates: [80.2319, 13.0827], // Chennai coordinates
          address: 'Chennai, India'
        }
      });

      const res = await api.get('/api/v1/parkings?near=13.0827,80.2319,10'); // 10km radius around Chennai
      
      expect(res.statusCode).toEqual(200);
      expect(res.body.data.parkings.length).toBe(1);
      expect(res.body.data.parkings[0].location.address).toMatch(/chennai/i);
    });
  });

  describe('GET /api/v1/parkings/:id', () => {
    it('should get a single parking by ID', async () => {
      const res = await api.get(`/api/v1/parkings/${testParking._id}`);
      
      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('success');
      expect(res.body.data.parking).toHaveProperty('name', 'Test Parking');
      expect(res.body.data.parking).toHaveProperty('availableSlots');
    });

    it('should return 404 for non-existent parking', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const res = await api.get(`/api/v1/parkings/${nonExistentId}`);
      
      expect(res.statusCode).toEqual(404);
      expect(res.body.status).toEqual('fail');
    });
  });

  describe('POST /api/v1/parkings', () => {
    it('should create a new parking with valid data (owner)', async () => {
      const newParking = {
        name: 'New Test Parking',
        description: 'A new test parking space',
        location: {
          type: 'Point',
          coordinates: [77.5946, 12.9716],
          address: 'Bangalore, India'
        },
        totalSlots: 5,
        slots: [
          { slotId: 'A1', number: 1, type: 'car', status: 'available', pricePerHour: 50 },
          { slotId: 'A2', number: 2, type: 'bike', status: 'available', pricePerHour: 30 }
        ],
        is24x7: true
      };

      const res = await api.post(
        '/api/v1/parkings',
        newParking,
        testToken
      );

      expect(res.statusCode).toEqual(201);
      expect(res.body.status).toEqual('success');
      expect(res.body.data.parking).toHaveProperty('name', 'New Test Parking');
      expect(res.body.data.parking.owner).toEqual(testUser._id.toString());
    });

    it('should return 403 if user is not an owner or admin', async () => {
      // Create a regular user (non-owner)
      const regularUser = await createTestUser({ role: 'user', email: 'regular@example.com' });
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'regular@example.com', password: 'test1234' });
      
      const regularToken = loginRes.body.token;

      const res = await api.post(
        '/api/v1/parkings',
        { name: 'Unauthorized Parking' },
        regularToken
      );

      expect(res.statusCode).toEqual(403);
      expect(res.body.status).toEqual('fail');
    });
  });

  describe('PATCH /api/v1/parkings/:id', () => {
    it('should update parking with valid data', async () => {
      const updates = {
        name: 'Updated Test Parking',
        description: 'Updated description',
        is24x7: false
      };

      const res = await api.patch(
        `/api/v1/parkings/${testParking._id}`,
        updates,
        testToken
      );

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('success');
      expect(res.body.data.parking).toHaveProperty('name', 'Updated Test Parking');
      expect(res.body.data.parking).toHaveProperty('is24x7', false);
    });

    it('should return 403 if user is not the owner or admin', async () => {
      // Create another owner
      const otherOwner = await createTestUser({ 
        role: 'owner', 
        email: 'other@example.com' 
      });
      
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'other@example.com', password: 'test1234' });
      
      const otherToken = loginRes.body.token;

      const res = await api.patch(
        `/api/v1/parkings/${testParking._id}`,
        { name: 'Unauthorized Update' },
        otherToken
      );

      expect(res.statusCode).toEqual(403);
      expect(res.body.status).toEqual('fail');
    });
  });

  describe('DELETE /api/v1/parkings/:id', () => {
    it('should soft delete parking (admin only)', async () => {
      // Create an admin user
      const admin = await createTestUser({ 
        role: 'admin', 
        email: 'admin@example.com' 
      });
      
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@example.com', password: 'test1234' });
      
      const adminToken = loginRes.body.token;

      // Create a parking to be deleted
      const parkingToDelete = await createTestParking(testUser._id, {
        name: 'Parking to Delete'
      });

      const res = await api.delete(
        `/api/v1/parkings/${parkingToDelete._id}`,
        adminToken
      );

      expect(res.statusCode).toEqual(204);

      // Verify parking is soft-deleted
      const deletedParking = await Parking.findById(parkingToDelete._id);
      expect(deletedParking.isActive).toBe(false);
    });
  });

  describe('GET /api/v1/parkings/:id/availability', () => {
    it('should check parking availability', async () => {
      const now = new Date();
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
      
      const res = await api.get(
        `/api/v1/parkings/${testParking._id}/availability?date=${now.toISOString()}&duration=60`
      );

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('success');
      expect(res.body.data).toHaveProperty('isOpen');
      expect(res.body.data).toHaveProperty('availableSlots');
      expect(res.body.data).toHaveProperty('totalSlots');
    });
  });
});
