module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['./src/test/setup.js'],
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/src/test/',
    '/src/config/',
  ],
  testTimeout: 30000, // 30 seconds
};

// Add this to package.json under "scripts":
// "test": "cross-env NODE_ENV=test jest --detectOpenHandles --forceExit",
// "test:watch": "npm test -- --watch",
// "test:coverage": "npm test -- --coverage"
