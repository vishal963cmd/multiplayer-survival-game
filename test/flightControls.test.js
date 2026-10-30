'use strict';

const assert = require('node:assert/strict');
const FlightControls = require('../js/flightControls');

for (const key of ['w', 'W', 'ArrowUp']) assert.equal(FlightControls.directionForKey(key), 'up');
for (const key of ['s', 'S', 'ArrowDown']) assert.equal(FlightControls.directionForKey(key), 'down');
for (const key of ['a', 'A', 'ArrowLeft']) assert.equal(FlightControls.directionForKey(key), 'left');
for (const key of ['d', 'D', 'ArrowRight']) assert.equal(FlightControls.directionForKey(key), 'right');
assert.equal(FlightControls.directionForKey('Enter'), null);
assert.deepEqual(FlightControls.vectorForDirections(new Set(['up', 'right'])), { x: 1, y: -1 });
assert.deepEqual(FlightControls.vectorForDirections(new Set(['up', 'down'])), { x: 0, y: 0 });

console.log('Flight controls tests passed (WASD, arrows, diagonal and cancellation mapping).');
