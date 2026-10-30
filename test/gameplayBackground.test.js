'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const renderer = fs.readFileSync('js/spaceRenderer.js', 'utf8');

assert.doesNotMatch(html, /flight-background|<video[^>]+wayfarer-space-background\.mp4/,
  'the gameplay view does not mount the removed video or generated background image');
assert.doesNotMatch(html, /gameplayBackground\.js/,
  'the gameplay scene no longer depends on the image/video playback controller');
assert.doesNotMatch(renderer, /wayfarer-gameplay-ship\.png|drawWayfarerSprite|GameplayBackground/,
  'the playable ship is the original Canvas renderer, not an image overlay');
assert.match(renderer, /function drawBackdrop\(ctx, width, height, unit, vx, vy, now, particles, rays, shipSpeed, reducedMotion\)/,
  'the original procedural backdrop is restored inside the gameplay Canvas');
assert.match(renderer, /canvas\.getContext\('2d', \{ alpha: false \}\)/,
  'the procedural background and entities render together on an opaque Canvas');
assert.ok(fs.existsSync('assets/wayfarer-space-background.mp4'),
  'the original cinematic video is preserved as an unused asset');
console.log('Gameplay background tests passed (original Canvas space and ship renderers restored; media layers removed).');
