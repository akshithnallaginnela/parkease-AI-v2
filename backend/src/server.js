const http = require('http');
const app = require('./app');
const { initSocket } = require('./utils/socket');
const logger = require('./utils/logger');
const { connectDB } = require('./config/db');
const { connectRedis } = require('./config/redis');

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket
initSocket(server);

// Server configuration
const PORT = process.env.PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Connect to MongoDB
connectDB();

// Connect to Redis
connectRedis();

// Start server
server.listen(PORT, () => {
  logger.info(`Server running in ${NODE_ENV} mode on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error(`Error: ${err.message}`);
  // Close server & exit process
  server.close(() => process.exit(1));
});
