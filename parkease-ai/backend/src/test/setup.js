const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { getRedisClient } = require('../config/redis');
const { initSocket } = require('../utils/socket');

let mongoServer;
let redisClient;

// Mock Redis client for testing
jest.mock('../config/redis', () => {
  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    on: jest.fn(),
    connect: jest.fn(),
    quit: jest.fn(),
    isOpen: true,
  };
  return {
    getRedisClient: jest.fn().mockReturnValue(mockRedis),
  };
});

// Mock email sending
jest.mock('../utils/email', () => ({
  sendWelcome: jest.fn().mockResolvedValue(true),
  sendPasswordReset: jest.fn().mockResolvedValue(true),
  sendBookingConfirmation: jest.fn().mockResolvedValue(true),
}));

// Mock payment provider
jest.mock('razorpay', () => {
  return jest.fn().mockImplementation(() => ({
    orders: {
      create: jest.fn().mockResolvedValue({ id: 'order_test_123' }),
    },
    payments: {
      fetch: jest.fn().mockResolvedValue({ status: 'captured' }),
    },
  }));
});

beforeAll(async () => {
  // Start in-memory MongoDB server
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  
  // Connect to the in-memory database
  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  
  // Initialize Redis mock
  redisClient = getRedisClient();
  await redisClient.connect();
  
  // Mock Redis get/set
  redisClient.get.mockImplementation(() => Promise.resolve(null));
  redisClient.set.mockImplementation(() => Promise.resolve('OK'));
  redisClient.del.mockImplementation(() => Promise.resolve(1));
  
  // Initialize socket.io mock
  const http = require('http');
  const app = require('../../app');
  const server = http.createServer(app);
  initSocket(server);
});

beforeEach(async () => {
  // Clear all test data before each test
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
  
  // Clear all mocks
  jest.clearAllMocks();
});

afterAll(async () => {
  // Close database connections
  await mongoose.disconnect();
  await mongoServer.stop();
  if (redisClient) {
    await redisClient.quit();
  }
});

// Global test helpers
global.signup = async (userData = {}) => {
  const user = {
    name: 'Test User',
    email: 'test@example.com',
    password: 'test1234',
    passwordConfirm: 'test1234',
    phone: '1234567890',
    ...userData,
  };
  
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send(user);
    
  return {
    user: res.body.data.user,
    token: res.body.token,
  };
};

global.login = async (email = 'test@example.com', password = 'test1234') => {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });
    
  return {
    token: res.body.token,
    user: res.body.data.user,
  };
};
