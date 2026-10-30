'use strict';

const assert = require('node:assert/strict');
const Flight = require('../shared/spaceflight');
const { createFlightState, setFlightInput, predictShip } = Flight;
const SceneCoordinates = require('../js/sceneCoordinates');
const RendererBootstrap = require('../js/rendererBootstrap');

const rotations = [];
const translations = [];
const gradientStops = [];
const paintOrder = [];
const centeredFullCircleArcs = [];
const impactArcCenters = [];
global.window = { devicePixelRatio: 2, Spaceflight: Flight, SceneCoordinates };
require('../js/spaceRenderer');

let drawOps = 0;
let asteroidBlits = 0;
let strokes = 0;
let curvedTrails = 0;
let textureCreations = 0;
let reticleArcs = 0;
let radialGradientCreations = 0;
let transformCalls = 0;
let rectWidth = 960;
let contextOptions = null;
function gradient() { return { addColorStop(_position, color) { gradientStops.push(color); } }; }
const ctx = new Proxy({
  setTransform() { transformCalls++; },
  rotate: value => rotations.push(value),
  translate: (x, y) => translations.push([x, y]),
  fillRect: () => { paintOrder.push('background'); drawOps++; },
  clearRect: () => { paintOrder.push('clear'); drawOps++; },
  stroke: () => { strokes++; drawOps++; },
  drawImage: () => { asteroidBlits++; paintOrder.push('asteroid'); drawOps++; },
  arc: (...args) => {
    if (Math.abs(args[0] - 576) < 1 && Math.abs(args[1] - 270) < 1) impactArcCenters.push([args[0], args[1]]);
    if (Math.abs(args[0]) < 1e-9 && Math.abs(args[1]) < 1e-9 && args[3] === 0 && Math.abs(args[4] - Math.PI * 2) < 1e-9) centeredFullCircleArcs.push(args[2]);
    if ([.15, Math.PI * .65, Math.PI * 1.15, Math.PI * 1.65].includes(args[3])) reticleArcs++;
    drawOps++;
  },
  quadraticCurveTo: () => { curvedTrails++; drawOps++; },
  createLinearGradient: gradient,
  createRadialGradient: (...args) => { radialGradientCreations++; return gradient(...args); },
  get drawCount() { return drawOps; }
}, {
  get(target, key) {
    if (key in target) return target[key];
    if (typeof key === 'string') return (..._args) => { drawOps++; };
    return undefined;
  },
  set(target, key, value) { target[key] = value; return true; }
});
const canvas = {
  width: 300,
  height: 150,
  ownerDocument: { createElement() { textureCreations++; return { width: 0, height: 0, getContext: () => ctx }; } },
  getContext: (_type, options) => { contextOptions = options; return ctx; },
  getBoundingClientRect: () => ({ width: rectWidth, height: 540 })
};

const renderer = window.SpaceRenderer.create(canvas);
assert.equal(renderer.available, true, 'a live 2D context marks the renderer ready');
assert.equal(contextOptions.alpha, false, 'the restored procedural background is drawn opaquely by the original Canvas');
const clampedDisplayPoint = window.SpaceRenderer.predictProjectileDisplayPoint(
  { x: .4, y: .5, vx: .6, vy: 0, radius: .008 },
  { x: .6, y: .5, vx: 0, vy: 0, radius: .03 }, 1
);
assert.ok(clampedDisplayPoint.x < .6, 'render extrapolation clamps the pulse bolt to first contact instead of showing it beyond the asteroid');
assert.ok(Math.abs(Math.hypot(clampedDisplayPoint.x - .6, clampedDisplayPoint.y - .5) - .038) < 1e-12,
  'rendered pulse bolt stops at the same combined-radius surface used by authoritative collision');
const movingTargetDisplayPoint = window.SpaceRenderer.predictProjectileDisplayPoint(
  { x: .4, y: .5, vx: .6, vy: 0, radius: .008 },
  { x: .6, y: .5, vx: 0, vy: .12, radius: .03 }, 1
);
assert.ok(movingTargetDisplayPoint.x > clampedDisplayPoint.x,
  'display collision prediction sweeps against the moving target segment rather than its stale center');
const futureImpactNow = Date.now();
const gradientsBeforeFutureImpact = radialGradientCreations;
const futureStampedImpact = renderer.draw({ matchId: 'canvas-smoke', snapshotAt: futureImpactNow,
  ship: { x: .4, y: .5, heading: 0 }, asteroids: [], projectiles: [], collisionEvents: [], navigationEvents: [],
  weaponEvents: [{ id: 'confirmed_future_clock', matchId: 'canvas-smoke', at: futureImpactNow - 500,
    impactAt: futureImpactNow + 5000, impactX: .6, impactY: .5, destroyed: true }] }, 100, [], futureImpactNow);
assert.deepEqual(futureStampedImpact, { background: true, ship: true, asteroidsDrawn: 0 });
assert.ok(radialGradientCreations > gradientsBeforeFutureImpact,
  'an authoritative impact starts its visual effect immediately even when client/server wall clocks differ');
assert.ok(impactArcCenters.length > 0,
  'the confirmed impact flash is drawn at the authoritative collision coordinates');
const flight = createFlightState('canvas-smoke', Date.now());
setFlightInput(flight, 1, 0, 1, Date.now());
flight.collisionEvents.push({ id: 'impact_1', x: .5, y: .5, at: Date.now(), damage: 9, blocked: false });
const renderNow = Date.now();
flight.snapshotAt = renderNow - 1600;
flight.matchId = 'canvas-smoke';
flight.asteroids[0].health = 2;
flight.asteroids[0].maxHealth = 3;
flight.asteroids[0].damageMarks = [{ u: -.18, v: .12, eventId: 'shot_mark_01' }];
flight.weaponEvents = [{ id: 'shot_visual_01', matchId: 'canvas-smoke', at: renderNow - 80,
  fromX: flight.ship.x, fromY: flight.ship.y, impactX: flight.asteroids[0].x, impactY: flight.asteroids[0].y,
  destroyed: true, damage: 1 }];
flight.projectiles = [{ id: 'shot_visual_02', x: .55, y: .48, vx: .12, vy: -.03, radius: .008,
  updatedAt: renderNow, active: true }];
const authoritativeFlightBeforeDraw = JSON.stringify(flight);
paintOrder.length = 0;
renderer.draw(flight, 91, [{ id: 'boost_shields', remainingMs: 2000 }], renderNow);
assert.equal(centeredFullCircleArcs.length, 0, 'ordinary asteroids no longer receive artificial circular outline or halo arcs');
assert.ok(paintOrder.indexOf('background') >= 0 && paintOrder.indexOf('background') < paintOrder.indexOf('asteroid'),
  'space background operations precede shared asteroid texture blits');
assert.equal(paintOrder[0], 'background', 'each frame paints the restored opaque procedural background first');
assert.ok(gradientStops.includes('#17191b') && gradientStops.includes('#d9e6eb'),
  'the original clean procedural space and blue-gray gameplay ship palette are restored');
assert.ok(gradientStops.includes('#35495a') && /ctx\.fillStyle = '#234762'/.test(require('node:fs').readFileSync('js/spaceRenderer.js', 'utf8')),
  'the original ship retains its blue-gray hull and center panel');
assert.equal(JSON.stringify(flight), authoritativeFlightBeforeDraw, 'drawing does not mutate shared ship, health or asteroid state');
const unselectedReticleArcs = reticleArcs;
renderer.draw(flight, 91, [], renderNow + 1, flight.asteroids[0].id);
assert.equal(reticleArcs - unselectedReticleArcs, 4, 'aimed asteroid receives the four-part visible Gunner reticle');
assert.equal(canvas.width, 1920, 'canvas backing store accounts for device pixel ratio');
assert.equal(canvas.height, 1080, 'canvas backing store accounts for device pixel ratio');
assert.equal(transformCalls, 1, 'DPR transform is reset after initial backing-store resize');
assert.ok(drawOps > 100, 'draws layered background, asteroids, ship and impact effects');
assert.ok(strokes > 0, 'the authoritative travelling projectile renders a bright bolt and trail');
assert.ok(strokes > 500, 'the original procedural background renders its coherent tunnel filaments and trails');
assert.ok(curvedTrails >= 500, 'original moving trails bend through the tunnel');
assert.equal(renderer.getCacheStats().ambientRays, 112, 'the original procedural background ray field is restored');
assert.equal(renderer.getCacheStats().ambientParticles, 680, 'the original procedural background particle field is restored');
assert.equal(renderer.getCacheStats().asteroidTextures, 8, 'procedural asteroid textures are built once for the bounded field');
assert.equal(textureCreations, 8);
renderer.draw(flight, 91, [], renderNow + 120);
assert.equal(textureCreations, 8, 'redrawing reuses the cached rock materials');
const predicted = predictShip(flight.ship, 1600);
assert.ok(Math.abs(rotations.at(-1) - predicted.heading) < 1e-12,
  'rendered hull uses the same heading as its predicted travel path');
assert.ok(Math.abs(translations.at(-1)[0] - predicted.x * 960) < 1e-9 &&
  Math.abs(translations.at(-1)[1] - predicted.y * 540) < 1e-9,
  'rendered hull position and orientation come from the same physics prediction');
const emptyScene = renderer.draw({
  ship: { x: .4, y: .5, heading: 0 },
  asteroids: [],
  collisionEvents: [], navigationEvents: [], weaponEvents: []
}, 100, [], renderNow + 140);
assert.deepEqual(emptyScene, { background: true, ship: true, asteroidsDrawn: 0 },
  'empty or delayed asteroid state still draws the authoritative ship and world background');
const partialScene = renderer.draw({
  matchId: 'canvas-smoke', snapshotAt: renderNow + 120,
  ship: { x: .4, y: .5, heading: 0 },
  asteroids: [
    { id: 'bad', x: NaN, y: .4, radius: .04 },
    { id: 'valid', shapeSeed: 12, x: .7, y: .4, radius: .04 }
  ],
  collisionEvents: [], navigationEvents: [], weaponEvents: []
}, 100, [], renderNow + 150);
assert.deepEqual(partialScene, { background: true, ship: true, asteroidsDrawn: 1 },
  'invalid asteroid coordinates are skipped while valid authoritative asteroids still render');
const lastKnownShipScene = renderer.draw({
  matchId: 'canvas-smoke', snapshotAt: renderNow + 145,
  ship: { x: NaN, y: .5, heading: 0 },
  asteroids: [{ id: 'cache-rock', shapeSeed: 92, x: .63, y: .55, radius: .04, rotation: 0, spin: 0 }],
  collisionEvents: [], navigationEvents: [], weaponEvents: []
}, 100, [], renderNow + 160);
assert.deepEqual(lastKnownShipScene, { background: true, ship: true, asteroidsDrawn: 1 },
  'a brief partial poll reuses the last authoritative ship only within its match');
const blitsBeforeMissingShip = asteroidBlits;
const missingShipWithAsteroids = renderer.draw({
  matchId: 'syncing-match', snapshotAt: renderNow + 160,
  ship: { x: NaN, y: .5, heading: 0 },
  asteroids: [{ id: 'sync-valid', shapeSeed: 91, x: .62, y: .54, radius: .05, rotation: 0, spin: 0 }],
  collisionEvents: [], navigationEvents: [], weaponEvents: []
}, 100, [], renderNow + 160);
assert.deepEqual(missingShipWithAsteroids, { background: true, ship: false, asteroidsDrawn: 1 },
  'a malformed ship snapshot must not suppress valid shared asteroids');
assert.equal(asteroidBlits, blitsBeforeMissingShip + 1,
  'a valid asteroid texture is actually blitted when the ship snapshot is unavailable');
const syncingScene = renderer.draw({ matchId: 'new-match', ship: { x: NaN, y: .5, heading: 0 }, asteroids: [] }, 0, [], renderNow + 160);
assert.deepEqual(syncingScene, { background: true, ship: false, asteroidsDrawn: 0 },
  'invalid ship coordinates leave a visible background while waiting for a valid authoritative snapshot');
rectWidth = 480;
renderer.draw({ ship: { x: .4, y: .5, heading: 0 }, asteroids: [] }, 100, [], renderNow + 170);
assert.equal(canvas.width, 960, 'a responsive resize updates backing-store dimensions at DPR 2');
assert.equal(transformCalls, 2, 'resize resets rather than accumulating canvas transforms');
const originalConsoleError = console.error;
let contextErrorReported = false;
console.error = () => { contextErrorReported = true; };
const unavailableCanvas = window.SpaceRenderer.create({ getContext: () => null });
console.error = originalConsoleError;
assert.equal(unavailableCanvas.available, false, 'missing 2D context is exposed to the retry bootstrap');
assert.deepEqual(unavailableCanvas.draw(flight, 100, [], renderNow), { background: false, ship: false, asteroidsDrawn: 0 });
assert.equal(contextErrorReported, true, 'unavailable 2D context is explicitly diagnosed');

let rendererAttempts = 0;
const recoveredBootstrap = RendererBootstrap.create(canvas, () => {
  rendererAttempts++;
  return rendererAttempts === 1 ? unavailableCanvas : renderer;
}, 500);
assert.equal(recoveredBootstrap.get(1000), null, 'an unavailable initial context does not masquerade as a drawing renderer');
assert.equal(recoveredBootstrap.get(1200), null, 'context retry is bounded instead of running on every frame');
assert.equal(rendererAttempts, 1, 'failed renderer initialization respects its retry interval');
assert.equal(recoveredBootstrap.get(1500), renderer, 'renderer initialization recovers when the context becomes available');
assert.equal(recoveredBootstrap.get(1600), renderer, 'a healthy renderer is reused without recreation');
assert.equal(rendererAttempts, 2);

const fallbackRenderer = window.SpaceRenderer.create({
  ownerDocument: { createElement() { return { getContext: () => null }; } },
  getContext: () => ctx,
  getBoundingClientRect: () => ({ width: 480, height: 540 })
});
const fallbackScene = fallbackRenderer.draw({
  matchId: 'texture-fallback', ship: { x: .4, y: .5, heading: 0 },
  asteroids: [{ id: 'fallback-rock', shapeSeed: 302, x: .65, y: .48, radius: .04 }]
}, 100, [], renderNow + 180);
assert.deepEqual(fallbackScene, { background: true, ship: true, asteroidsDrawn: 1 },
  'procedural rock drawing remains available when an offscreen texture context is unavailable');

let measuredHeight = 0;
const lateLayoutRenderer = window.SpaceRenderer.create({
  width: 1, height: 1, getContext: () => ctx,
  getBoundingClientRect: () => ({ width: 480, height: measuredHeight })
});
assert.equal(lateLayoutRenderer.draw(flight, 100, [], renderNow + 180).background, false,
  'a not-yet-laid-out viewport does not pretend it rendered');
measuredHeight = 540;
assert.deepEqual(lateLayoutRenderer.draw({
  matchId: 'late-layout', ship: { x: .4, y: .5, heading: 0 },
  asteroids: [{ id: 'late-rock', shapeSeed: 303, x: .66, y: .51, radius: .04 }]
}, 100, [], renderNow + 190), { background: true, ship: true, asteroidsDrawn: 1 },
  'the renderer recovers on the next frame once responsive layout supplies usable dimensions');

const viewportMatrix = [
  [360, 800, 1], [390, 844, 2], [768, 1024, 1.25],
  [1366, 768, 1], [1920, 1080, 1.5], [2560, 1440, 2]
];
for (const [viewportWidth, viewportHeight, pixelRatio] of viewportMatrix) {
  window.devicePixelRatio = pixelRatio;
  window.innerWidth = viewportWidth;
  window.innerHeight = viewportHeight;
  let measuredWidth = viewportWidth;
  let measuredHeight = viewportHeight;
  const responsiveCanvas = {
    width: 0, height: 0,
    ownerDocument: { createElement() { return { width: 0, height: 0, getContext: () => ctx }; } },
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: measuredWidth, height: measuredHeight })
  };
  const responsiveRenderer = window.SpaceRenderer.create(responsiveCanvas);
  const world = {
    matchId: `viewport-${viewportWidth}`, snapshotAt: renderNow + 200,
    ship: { x: .37, y: .61, heading: 0, vx: 0, vy: 0, speed: 0, inputX: 0, inputY: 0 },
    asteroids: [{ id: 'viewport-rock', shapeSeed: viewportWidth, x: .72, y: .42,
      radius: .045, rotation: 0, spin: 0 }],
    collisionEvents: [], navigationEvents: [], weaponEvents: []
  };
  const beforeTranslations = translations.length;
  const scene = responsiveRenderer.draw(world, 100, [], renderNow + 200);
  assert.deepEqual(scene, { background: true, ship: true, asteroidsDrawn: 1 },
    `real world entities draw at ${viewportWidth}x${viewportHeight}`);
  assert.equal(responsiveCanvas.width, Math.round(viewportWidth * Math.min(2, pixelRatio)),
    `backing width uses the measured viewport and one DPR scale at ${viewportWidth}x${viewportHeight}`);
  assert.equal(responsiveCanvas.height, Math.round(viewportHeight * Math.min(2, pixelRatio)),
    `backing height uses the measured viewport and one DPR scale at ${viewportWidth}x${viewportHeight}`);
  assert.ok(translations.slice(beforeTranslations).some(([x, y]) =>
    Math.abs(x - .37 * viewportWidth) < 1e-6 && Math.abs(y - .61 * viewportHeight) < 1e-6),
  `ship world coordinates map consistently to measured screen dimensions at ${viewportWidth}x${viewportHeight}`);
  measuredWidth = Math.max(1, viewportWidth - 80);
  responsiveRenderer.draw(world, 100, [], renderNow + 201);
  assert.equal(responsiveCanvas.width, Math.round(measuredWidth * Math.min(2, pixelRatio)),
    `container-only resize is detected without relying on window width at ${viewportWidth}x${viewportHeight}`);
}

console.log('Space renderer smoke passed (responsive canvas setup and world drawing path).');
