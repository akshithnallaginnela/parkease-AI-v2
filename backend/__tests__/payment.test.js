const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../app');
const Booking = require('../src/models/booking.model');
const Parking = require('../src/models/parking.model');
const User = require('../src/models/user.model');
const { createTestUser, createTestParking, api } = require('../src/test/testHelper');

// Mock Razorpay
jest.mock('razorpay');
const Razorpay = require('razorpay');

// Mock crypto for webhook signature verification
jest.mock('crypto', () => ({
  createHmac: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  digest: jest.fn().mockReturnValue('mocked_signature')
}));

describe('Payment API', () => {
  let testUser;
  let testToken;
  let testBooking;
  let testParking;
  let testSlotId;
  
  // Mock Razorpay instance
  const mockRazorpay = {
    orders: {
      create: jest.fn().mockResolvedValue({
        id: 'order_test_123',
        amount: 10000, // 100.00 in paise
        currency: 'INR',
        status: 'created'
      }),
      fetchPayments: jest.fn().mockResolvedValue({
        items: [{
          id: 'pay_test_123',
          amount: 10000,
          currency: 'INR',
          status: 'captured',
          order_id: 'order_test_123',
          created_at: Math.floor(Date.now() / 1000)
        }]
      })
    },
    payments: {
      fetch: jest.fn().mockResolvedValue({
        id: 'pay_test_123',
        amount: 10000,
        currency: 'INR',
        status: 'captured',
        order_id: 'order_test_123',
        created_at: Math.floor(Date.now() / 1000)
      }),
      capture: jest.fn().mockResolvedValue({
        id: 'pay_test_123',
        status: 'captured'
      })
    }
  };

  beforeAll(async () => {
    // Set up mock Razorpay
    Razorpay.mockImplementation(() => mockRazorpay);
    
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
        name: 'Test Parking for Payment',
        slots: [
          { slotId: 'pay-slot-1', number: 1, type: 'car', status: 'available', pricePerHour: 50 },
        ]
      }
    );
    testSlotId = testParking.slots[0]._id;

    // Create a test booking
    testBooking = await Booking.create({
      user: testUser._id,
      parking: testParking._id,
      slot: testSlotId,
      slotNumber: 'A1',
      startTime: new Date(),
      endTime: new Date(Date.now() + 60 * 60 * 1000), // 1 hour later
      status: 'pending',
      amount: 50,
      payment: {
        method: 'online',
        status: 'pending',
        gateway: 'razorpay',
        orderId: 'order_test_123'
      },
      vehicle: {
        type: 'car',
        number: 'KA01AB1234'
      }
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/payments/create-order', () => {
    it('should create a payment order for a booking', async () => {
      const res = await api.post(
        '/api/v1/payments/create-order',
        {
          bookingId: testBooking._id,
          amount: 50,
          currency: 'INR',
          receipt: `booking_${testBooking._id}`
        },
        testToken
      );

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('success');
      expect(res.body.data).toHaveProperty('order');
      expect(res.body.data.order.id).toBe('order_test_123');
      
      // Verify Razorpay order was created with correct parameters
      expect(mockRazorpay.orders.create).toHaveBeenCalledWith({
        amount: 5000, // 50.00 in paise
        currency: 'INR',
        receipt: `booking_${testBooking._id}`,
        payment_capture: 1
      });
      
      // Verify booking was updated with order ID
      const updatedBooking = await Booking.findById(testBooking._id);
      expect(updatedBooking.payment.orderId).toBe('order_test_123');
    });

    it('should return 400 if booking is already paid', async () => {
      // Update booking to already paid status
      await Booking.findByIdAndUpdate(testBooking._id, {
        'payment.status': 'completed'
      });

      const res = await api.post(
        '/api/v1/payments/create-order',
        {
          bookingId: testBooking._id,
          amount: 50,
          currency: 'INR'
        },
        testToken
      );

      expect(res.statusCode).toEqual(400);
      expect(res.body.status).toEqual('fail');
      expect(res.body.message).toMatch(/already paid/i);
    });
  });

  describe('POST /api/v1/payments/verify', () => {
    it('should verify a successful payment', async () => {
      // Mock successful payment verification
      mockRazorpay.payments.fetch.mockResolvedValueOnce({
        id: 'pay_test_123',
        order_id: 'order_test_123',
        amount: 5000,
        currency: 'INR',
        status: 'captured',
        created_at: Math.floor(Date.now() / 1000)
      });

      const paymentData = {
        razorpay_order_id: 'order_test_123',
        razorpay_payment_id: 'pay_test_123',
        razorpay_signature: 'mocked_signature',
        bookingId: testBooking._id
      };

      const res = await api.post(
        '/api/v1/payments/verify',
        paymentData,
        testToken
      );

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('success');
      expect(res.body.data.booking.status).toBe('confirmed');
      expect(res.body.data.booking.payment.status).toBe('completed');
      
      // Verify payment was captured
      expect(mockRazorpay.payments.capture).toHaveBeenCalledWith(
        'pay_test_123',
        5000,
        'INR'
      );
    });

    it('should return 400 for invalid signature', async () => {
      // Mock signature verification failure
      require('crypto').createHmac.mockReturnValueOnce({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue('invalid_signature')
      });

      const paymentData = {
        razorpay_order_id: 'order_test_123',
        razorpay_payment_id: 'pay_test_123',
        razorpay_signature: 'invalid_signature',
        bookingId: testBooking._id
      };

      const res = await api.post(
        '/api/v1/payments/verify',
        paymentData,
        testToken
      );

      expect(res.statusCode).toEqual(400);
      expect(res.body.status).toEqual('fail');
      expect(res.body.message).toMatch(/invalid signature/i);
    });
  });

  describe('POST /api/v1/payments/webhook', () => {
    it('should handle payment.captured webhook event', async () => {
      const webhookPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_test_123',
              order_id: 'order_test_123',
              amount: 5000,
              currency: 'INR',
              status: 'captured',
              created_at: Math.floor(Date.now() / 1000)
            }
          }
        }
      };

      // Mock Razorpay webhook signature
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret';
      const signature = 'mocked_webhook_signature';

      const res = await request(app)
        .post('/api/v1/payments/webhook')
        .set('x-razorpay-signature', signature)
        .send(webhookPayload);

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('success');
      
      // Verify booking was updated
      const updatedBooking = await Booking.findOne({ 'payment.orderId': 'order_test_123' });
      expect(updatedBooking.status).toBe('confirmed');
      expect(updatedBooking.payment.status).toBe('completed');
    });

    it('should return 401 for invalid webhook signature', async () => {
      // Mock invalid signature
      const webhookPayload = { event: 'payment.captured' };
      
      const res = await request(app)
        .post('/api/v1/payments/webhook')
        .set('x-razorpay-signature', 'invalid_signature')
        .send(webhookPayload);

      expect(res.statusCode).toEqual(401);
      expect(res.body.status).toEqual('fail');
      expect(res.body.message).toMatch(/invalid webhook signature/i);
    });
  });

  describe('GET /api/v1/payments/history', () => {
    it('should get payment history for the authenticated user', async () => {
      // Create a test payment history
      await Booking.create([
        {
          user: testUser._id,
          parking: testParking._id,
          slot: testSlotId,
          slotNumber: 'A1',
          startTime: new Date(),
          endTime: new Date(Date.now() + 60 * 60 * 1000),
          status: 'completed',
          amount: 50,
          payment: {
            method: 'online',
            status: 'completed',
            gateway: 'razorpay',
            orderId: 'order_test_456',
            transactionId: 'txn_test_456',
            amount: 50,
            currency: 'INR',
            paidAt: new Date()
          },
          vehicle: {
            type: 'car',
            number: 'KA01AB1234'
          }
        },
        {
          user: testUser._id,
          parking: testParking._id,
          slot: testSlotId,
          slotNumber: 'A2',
          startTime: new Date(),
          endTime: new Date(Date.now() + 60 * 60 * 1000),
          status: 'completed',
          amount: 30,
          payment: {
            method: 'online',
            status: 'completed',
            gateway: 'razorpay',
            orderId: 'order_test_789',
            transactionId: 'txn_test_789',
            amount: 30,
            currency: 'INR',
            paidAt: new Date()
          },
          vehicle: {
            type: 'bike',
            number: 'KA01CD5678'
          }
        }
      ]);

      const res = await api.get(
        '/api/v1/payments/history',
        null,
        testToken
      );

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('success');
      expect(Array.isArray(res.body.data.payments)).toBeTruthy();
      expect(res.body.results).toBeGreaterThanOrEqual(2);
      
      // Verify the payments are sorted by date (newest first)
      const payments = res.body.data.payments;
      for (let i = 0; i < payments.length - 1; i++) {
        expect(new Date(payments[i].paidAt) >= new Date(payments[i + 1].paidAt)).toBeTruthy();
      }
    });
  });
});
