// Test that local dev store initializes without uncachedEdgeURL env var
const { _store } = require('../netlify/functions/game');

let store;
try {
  store = _store();
} catch (e) {
  console.error('Dev store init error:', e);
  process.exit(1);
}

if (typeof store.getWithMetadata !== 'function') {
  console.error('Dev store does not have getWithMetadata');
  process.exit(1);
}

console.log('Dev store test passed');
process.exit(0);
