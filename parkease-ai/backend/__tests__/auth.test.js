const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../app');
const User = require('../src/models/user.model');
const { createTestUser } = require('../src/test/testHelper');

describe('Authentication API', () => {
  let testUser;
  
  beforeEach(async () => {
    // Create a test user before each test
    testUser = await createTestUser();
  });

  describe('POST /api/v1/auth/signup', () => {
    it('should create a new user with valid data', async () => {
      const newUser = {
        name: 'New User',
        email: 'newuser@example.com',
        password: 'test1234',
        passwordConfirm: 'test1234',
        phone: '9876543210',
      };

      const res = await request(app)
        .post('/api/v1/auth/signup')
        .send(newUser);

      expect(res.statusCode).toEqual(201);
      expect(res.body).toHaveProperty('status', 'success');
      expect(res.body.data.user).toHaveProperty('email', newUser.email);
      expect(res.body.data.user).toHaveProperty('name', newUser.name);
      expect(res.body).toHaveProperty('token');
    });

    it('should return 400 if required fields are missing', async () => {
      const res = await request(app)
        .post('/api/v1/auth/signup')
        .send({
          name: 'Incomplete User',
          email: 'incomplete@example.com',
          // Missing password and other required fields
        });

      expect(res.statusCode).toEqual(400);
      expect(res.body.status).toEqual('fail');
    });

    it('should return 400 if passwords do not match', async () => {
      const res = await request(app)
        .post('/api/v1/auth/signup')
        .send({
          name: 'Password Mismatch',
          email: 'password@example.com',
          password: 'password123',
          passwordConfirm: 'differentpassword',
          phone: '9876543211',
        });

      expect(res.statusCode).toEqual(400);
      expect(res.body.status).toEqual('fail');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login user with correct credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
          password: 'test1234',
        });

      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('status', 'success');
      expect(res.body).toHaveProperty('token');
      expect(res.body.data.user).toHaveProperty('email', 'test@example.com');
    });

    it('should return 401 with invalid credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword',
        });

      expect(res.statusCode).toEqual(401);
      expect(res.body.status).toEqual('fail');
      expect(res.body.message).toMatch(/incorrect email or password/i);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should get current user with valid token', async () => {
      // First login to get token
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
          password: 'test1234',
        });

      const token = loginRes.body.token;

      // Get current user
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('success');
      expect(res.body.data.user).toHaveProperty('email', 'test@example.com');
    });

    it('should return 401 without token', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.statusCode).toEqual(401);
      expect(res.body.message).toMatch(/you are not logged in/i);
    });
  });

  describe('POST /api/v1/auth/forgot-password', () => {
    it('should send password reset token to email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'test@example.com' });

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('success');
      expect(res.body.message).toMatch(/token sent to email/i);

      // Verify password reset token was set in the database
      const user = await User.findOne({ email: 'test@example.com' });
      expect(user.passwordResetToken).toBeDefined();
      expect(user.passwordResetExpires).toBeDefined();
    });

    it('should return 404 if email does not exist', async () => {
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nonexistent@example.com' });

      expect(res.statusCode).toEqual(404);
      expect(res.body.status).toEqual('fail');
    });
  });

  describe('PATCH /api/v1/auth/reset-password/:token', () => {
    let resetToken;
    
    beforeEach(async () => {
      // Generate a reset token for the test user
      resetToken = testUser.createPasswordResetToken();
      await testUser.save({ validateBeforeSave: false });
    });

    it('should reset password with valid token', async () => {
      const res = await request(app)
        .patch(`/api/v1/auth/reset-password/${resetToken}`)
        .send({
          password: 'newpassword123',
          passwordConfirm: 'newpassword123',
        });

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('success');
      expect(res.body).toHaveProperty('token');

      // Verify password was changed by trying to login with new password
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
          password: 'newpassword123',
        });

      expect(loginRes.statusCode).toEqual(200);
    });

    it('should return 400 with invalid token', async () => {
      const res = await request(app)
        .patch('/api/v1/auth/reset-password/invalidtoken')
        .send({
          password: 'newpassword123',
          passwordConfirm: 'newpassword123',
        });

      expect(res.statusCode).toEqual(400);
      expect(res.body.status).toEqual('fail');
      expect(res.body.message).toMatch(/token is invalid or has expired/i);
    });
  });

  describe('PATCH /api/v1/auth/update-password', () => {
    let token;
    
    beforeEach(async () => {
      // Login to get token
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
          password: 'test1234',
        });
      
      token = loginRes.body.token;
    });

    it('should update password with correct current password', async () => {
      const res = await request(app)
        .patch('/api/v1/auth/update-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          passwordCurrent: 'test1234',
          password: 'newpassword123',
          passwordConfirm: 'newpassword123',
        });

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('success');
      expect(res.body).toHaveProperty('token');

      // Verify password was changed by trying to login with new password
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
          password: 'newpassword123',
        });

      expect(loginRes.statusCode).toEqual(200);
    });

    it('should return 401 with incorrect current password', async () => {
      const res = await request(app)
        .patch('/api/v1/auth/update-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          passwordCurrent: 'wrongpassword',
          password: 'newpassword123',
          passwordConfirm: 'newpassword123',
        });

      expect(res.statusCode).toEqual(401);
      expect(res.body.status).toEqual('fail');
      expect(res.body.message).toMatch(/your current password is wrong/i);
    });
  });
});
