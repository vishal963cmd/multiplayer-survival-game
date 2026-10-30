'use strict';

const assert = require('node:assert/strict');
global.window = { App: { state: { room: null } } };
require('../js/poller');
const interval = window.Poller.getPollIntervalMs;
assert.equal(interval({ phase: 'lobby' }), 1500, 'lobby polling keeps its existing low request rate');
assert.equal(interval({ phase: 'playing', round: { flight: { projectiles: [] } } }), 250,
  'live gameplay snapshots are refreshed promptly for remote crew');
assert.equal(interval({ phase: 'playing', round: { flight: { projectiles: [{ active: true }] } } }), 80,
  'both clients poll rapidly while a projectile is in flight so impact commits and synchronizes promptly');
assert.equal(interval({ phase: 'playing', round: { flight: { projectiles: [{ active: false }] } } }), 250,
  'completed projectiles return clients to the normal gameplay poll interval');
console.log('Poller tests passed (adaptive gameplay and in-flight projectile cadence).');
