'use strict';

const assert = require('node:assert/strict');
global.window = { App: { state: { room: null } } };
require('../js/poller');
const interval = window.Poller.getPollIntervalMs;
assert.equal(interval({ phase: 'lobby' }), 1500, 'lobby polling keeps its existing low request rate');
assert.equal(interval({ phase: 'playing', round: { flight: { projectiles: [] } } }), 750,
  'live gameplay polling allows hosted request latency plus a spacing delay before another room write');
assert.equal(interval({ phase: 'playing', round: { flight: { projectiles: [{ active: true }] } } }), 650,
  'projectiles use a bounded faster cadence without flooding the shared room Blob');
assert.equal(interval({ phase: 'playing', round: { flight: { projectiles: [{ active: false }] } } }), 750,
  'completed projectiles return clients to the normal gameplay poll interval');
assert.equal(window.Poller.nextErrorBackoffMs(0), 1500, 'the first failed poll backs off to the lobby cadence');
assert.equal(window.Poller.nextErrorBackoffMs(1500), 3000, 'repeated failures increase the retry delay');
assert.equal(window.Poller.nextErrorBackoffMs(6000), 8000, 'retry backoff is bounded');
console.log('Poller tests passed (bounded gameplay cadence and capped retry backoff).');
