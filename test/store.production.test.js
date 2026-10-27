// Test that production store does not fallback to file mock
// This test sets the AWS_LAMBDA_FUNCTION_NAME env var to simulate production
// and ensures that the store returned is a Netlify Blobs store (has getWithMetadata function)
// and that no .netlify_mock_store.json file is created.

const path = require('path');
const fs = require('fs');
const storeFile = path.resolve(__dirname, '..', '..', '.netlify_mock_store.json');

// Preserve original env
const originalEnv = process.env.AWS_LAMBDA_FUNCTION_NAME;
process.env.AWS_LAMBDA_FUNCTION_NAME = 'test-prod';

const { _store } = require('../netlify/functions/game');

let store;
try {
  store = _store();
} catch (e) {
  console.error('Store init error in prod test:', e);
  process.exit(1);
}

if (typeof store.getWithMetadata !== 'function') {
  console.error('Production store does not have getWithMetadata');
  process.exit(1);
}

if (fs.existsSync(storeFile)) {
  console.error('.netlify_mock_store.json should not be created in production mode');
  process.exit(1);
}

console.log('Production store test passed');
process.exit(0);
