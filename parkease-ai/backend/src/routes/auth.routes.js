const express = require('express');
const authController = require('../controllers/auth.controller');
const userController = require('../controllers/user.controller');
const { catchAsync } = require('../utils/catchAsync');

const router = express.Router();

// Authentication routes
router.post('/signup', catchAsync(authController.signup));
router.post('/login', catchAsync(authController.login));
router.get('/logout', catchAsync(authController.logout));

// Password reset routes
router.post('/forgot-password', catchAsync(authController.forgotPassword));
router.patch('/reset-password/:token', catchAsync(authController.resetPassword));

// Protect all routes after this middleware
router.use(catchAsync(authController.protect));

// Update password for authenticated users
router.patch('/update-password', catchAsync(authController.updatePassword));

// Get current user
router.get('/me', catchAsync(userController.getMe), catchAsync(userController.getUser));

// Update current user data
router.patch(
  '/update-me',
  userController.uploadUserPhoto,
  userController.resizeUserPhoto,
  catchAsync(userController.updateMe)
);

// Deactivate current user
router.delete('/delete-me', catchAsync(userController.deleteMe));

// Restrict the following routes to admin only
router.use(catchAsync(authController.restrictTo('admin')));

// Admin routes for user management
router
  .route('/')
  .get(catchAsync(userController.getAllUsers))
  .post(catchAsync(userController.createUser));

router
  .route('/:id')
  .get(catchAsync(userController.getUser))
  .patch(catchAsync(userController.updateUser))
  .delete(catchAsync(userController.deleteUser));

module.exports = router;
