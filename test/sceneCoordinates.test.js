'use strict';

const assert = require('node:assert/strict');
const SceneCoordinates = require('../js/sceneCoordinates');

const flight = { snapshotAt: 1_000, ship: {}, asteroids: [] };
const asteroid = { x: .6, y: .4, vx: .1, vy: -.05 };
assert.deepEqual(SceneCoordinates.asteroidPosition(asteroid, flight, 2_000), { x: .7, y: .35000000000000003 });
assert.deepEqual(SceneCoordinates.asteroidPosition(asteroid, flight, 5_000), { x: .76, y: .32 },
  'client prediction is bounded to the same 1.6-second window used by the scene');
assert.deepEqual(SceneCoordinates.pointerToWorld(350, 250, { left: 50, top: 50, width: 600, height: 400 }),
  { x: .5, y: .5 }, 'CSS-scaled pointer coordinates map to normalized scene coordinates');
assert.equal(SceneCoordinates.pointerToWorld(5, 5, { left: 0, top: 0, width: 0, height: 10 }), null);

console.log('Scene coordinate tests passed (bounded snapshot prediction and CSS pointer mapping).');
