'use strict';

const assert = require('node:assert/strict');
const {
  WORLD, createFlightState, normalizeInput, normalizeAngle, advanceFlight,
  predictShip, armAsteroidHazard, divertAsteroidHazard, getThreatRadar,
  resolvePulseCannonHit
} = require('../shared/spaceflight');

function makeCollisionFlight() {
  const flight = createFlightState('test-flight', 1000);
  flight.ship.x = 0.43;
  flight.ship.y = 0.52;
  flight.ship.heading = 0;
  flight.ship.speed = 0;
  flight.ship.inputY = -1;
  flight.asteroids = [{
    id: 'rock_test', shapeSeed: 123, x: 0.54, y: 0.52,
    vx: 0, vy: 0, radius: 0.02, rotation: 0, spin: 0
  }];
  return flight;
}

const diagonal = normalizeInput(1, 1);
assert.ok(Math.abs(diagonal.x - Math.SQRT1_2) < 1e-12 && Math.abs(diagonal.y - Math.SQRT1_2) < 1e-12);
assert.deepEqual(normalizeInput(-1, 0), { x: -1, y: 0 });
assert.throws(() => normalizeInput(2, 0), /must be -1, 0, or 1/);

const flight = createFlightState('same-seed', 1000);
assert.equal(flight.asteroids.length, WORLD.maxAsteroids);
assert.deepEqual(flight.asteroids, createFlightState('same-seed', 1000).asteroids);
assert.ok(Math.abs(flight.ship.heading + Math.PI / 2) < 1e-12, 'initial ship nose points up in screen coordinates');
assert.ok(new Set(flight.asteroids.map(rock => rock.shapeSeed)).size > 1, 'asteroids have varied procedural silhouettes');
assert.ok(Math.max(...flight.asteroids.map(rock => rock.radius)) > Math.min(...flight.asteroids.map(rock => rock.radius)), 'asteroids have varied sizes');
assert.ok(flight.asteroids.every(rock => rock.health === 3 && rock.maxHealth === 3), 'each asteroid begins with authoritative health');
const weaponFlight = createFlightState('weapon-seed', 1000);
weaponFlight.ship.x = .4; weaponFlight.ship.y = .5;
weaponFlight.asteroids = [{ id: 'rock_target', shapeSeed: 45, x: .6, y: .5, vx: 0, vy: 0, radius: .03,
  rotation: .2, spin: 0, health: 9, maxHealth: 9, damageMarks: [] }];
assert.equal(resolvePulseCannonHit(weaponFlight, 'rock_missing', 1200, 'weapon-match').error, 'That asteroid is no longer in this match.');
weaponFlight.asteroids[0].x = 1.1;
assert.equal(resolvePulseCannonHit(weaponFlight, 'rock_target', 1250, 'weapon-match').error, 'That asteroid is outside pulse-cannon range.');
weaponFlight.asteroids[0].x = .6;
const destroyedShot = resolvePulseCannonHit(weaponFlight, 'rock_target', 1300, 'weapon-match');
assert.equal(destroyedShot.error, undefined);
assert.equal(destroyedShot.destroyed, true, 'one authoritative hit destroys the asteroid regardless of its prior health');
assert.equal(destroyedShot.event.healthBefore, 9);
assert.equal(destroyedShot.event.healthAfter, 0);
assert.equal(destroyedShot.event.damage, 9);
assert.deepEqual([destroyedShot.event.impactX, destroyedShot.event.impactY], [.57, .5], 'hit point lies on the actual target surface');
assert.equal(weaponFlight.asteroids.some(rock => rock.id === 'rock_target'), false, 'destroyed asteroid leaves active state');
assert.equal(weaponFlight.asteroids.length, 1, 'destroyed target is replaced by one distant incoming asteroid');
assert.equal(weaponFlight.weaponEvents.filter(event => event.destroyed).length, 1, 'one stable event represents the single destruction');
assert.notEqual(weaponFlight.asteroids[0].id, 'rock_target', 'replacement asteroid has a new identity and collision state');
assert.equal(resolvePulseCannonHit(weaponFlight, 'rock_target', 1500, 'weapon-match').error, 'That asteroid is no longer in this match.');
flight.ship.inputY = -1;
advanceFlight(flight, 2000);
assert.ok(flight.ship.y < 0.52 && flight.ship.speed > 0, 'W-style thrust accelerates along the ship heading');
assert.ok(Math.abs(flight.ship.x - 0.43) < 1e-12, 'forward thrust follows the initial nose direction');
const maxSpeedFlight = createFlightState('max-speed', 1000);
maxSpeedFlight.ship.inputY = -1;
for (let now = 2000; now <= 20_000; now += 2000) advanceFlight(maxSpeedFlight, now);
assert.ok(maxSpeedFlight.ship.speed <= WORLD.maxShipSpeed, 'forward speed is capped');
const speedBeforeDamping = maxSpeedFlight.ship.speed;
maxSpeedFlight.ship.inputY = 0;
advanceFlight(maxSpeedFlight, 21_000);
assert.ok(maxSpeedFlight.ship.speed < speedBeforeDamping, 'coasting applies speed damping');
const turnFlight = createFlightState('turn', 1000);
const originalHeading = turnFlight.ship.heading;
turnFlight.ship.inputX = -1;
advanceFlight(turnFlight, 2000);
assert.ok(normalizeAngle(turnFlight.ship.heading - originalHeading) < 0, 'A/Left steering turns the nose left');
const rightTurnFlight = createFlightState('right-turn', 1000);
rightTurnFlight.ship.inputX = 1;
advanceFlight(rightTurnFlight, 2000);
assert.ok(normalizeAngle(rightTurnFlight.ship.heading - originalHeading) > 0, 'D/Right steering turns the nose right');
const brakeFlight = createFlightState('braking', 1000);
brakeFlight.ship.inputY = -1;
advanceFlight(brakeFlight, 3000);
const speedBeforeBrake = brakeFlight.ship.speed;
brakeFlight.ship.inputY = 1;
advanceFlight(brakeFlight, 5000);
assert.ok(brakeFlight.ship.speed < speedBeforeBrake && brakeFlight.ship.speed >= 0,
  'S/Down brakes without sending the ship backward while its nose faces forward');
const predictionSource = createFlightState('predict-curve', 1000);
predictionSource.ship.inputY = -1;
predictionSource.ship.inputX = 1;
const authoritativeStep = JSON.parse(JSON.stringify(predictionSource));
advanceFlight(authoritativeStep, 1800);
const predictedStep = predictShip(predictionSource.ship, 800);
for (const axis of ['x', 'y', 'heading', 'speed']) {
  assert.ok(Math.abs(predictedStep[axis] - authoritativeStep.ship[axis]) < 1e-12,
    `renderer prediction matches authoritative ${axis}`);
}
const boundaryFlight = createFlightState('boundary', 1000);
boundaryFlight.ship.x = WORLD.minX + 0.01;
boundaryFlight.ship.heading = Math.PI;
boundaryFlight.ship.inputY = -1;
for (let now = 2000; now <= 20_000; now += 2000) advanceFlight(boundaryFlight, now);
assert.equal(boundaryFlight.ship.x, WORLD.minX, 'ship remains inside the left world boundary');
assert.ok(flight.asteroids.length <= WORLD.maxAsteroids, 'asteroid count stays bounded');

const hazardFlight = createFlightState('hazard', 1000);
const hazardId = armAsteroidHazard(hazardFlight, 'em_rogue_test');
const markedHazard = hazardFlight.asteroids.find(asteroid => asteroid.id === hazardId);
assert.equal(markedHazard.threatId, 'em_rogue_test', 'Navigator hazard points to one actual asteroid');
assert.ok(markedHazard.x > hazardFlight.ship.x && Math.abs(markedHazard.y - hazardFlight.ship.y) < 1e-12,
  'marked hazard is placed on an approaching path in the ship lane');
assert.equal(divertAsteroidHazard(hazardFlight, 'em_rogue_test', 1500), true,
  'Navigator diversion changes the marked asteroid state');
assert.equal(hazardFlight.asteroids.some(asteroid => asteroid.threatId === 'em_rogue_test'), false,
  'diversion removes the tagged asteroid from the active intercept path');
assert.equal(hazardFlight.navigationEvents.length, 1, 'diversion publishes a real navigation event');

const radarFlight = createFlightState('radar-test', 1000);
radarFlight.asteroids = [
  { id: 'rock_closing', x: .68, y: .5, vx: -.1, vy: 0, radius: .025 },
  { id: 'rock_receding', x: .68, y: .5, vx: .1, vy: 0, radius: .025 },
  { id: 'rock_far', x: .99, y: .99, vx: 0, vy: 0, radius: .025 }
];
radarFlight.navigatorMark = { asteroidId: 'rock_closing', nickname: 'Nav', matchId: 'match-a', expiresAt: 5000 };
const radar = getThreatRadar(radarFlight, 2000, 'match-a');
assert.equal(radar.targets.length, 2, 'radar includes nearby actual asteroids only');
assert.equal(radar.targets.find(target => target.asteroidId === 'rock_closing').threatLevel, 'high',
  'relative closing trajectory raises actual collision risk');
assert.equal(radar.targets.find(target => target.asteroidId === 'rock_receding').threatLevel, 'low',
  'a nearby receding asteroid is not reported as an imminent threat');
assert.equal(radar.markedThreat.asteroidId, 'rock_closing');
assert.equal(radar.targets.find(target => target.marked).asteroidId, 'rock_closing');
assert.equal(getThreatRadar(radarFlight, 5000, 'match-a').markedThreat, null,
  'expired marks are hidden');
assert.equal(getThreatRadar(radarFlight, 2000, 'match-b').markedThreat, null,
  'marks from an earlier match are hidden');

const movingRockFlight = createFlightState('moving-rock', 1000);
movingRockFlight.asteroids = [{
  id: 'rock_motion', shapeSeed: 4, x: .9, y: .1,
  vx: -.1, vy: 0, radius: .02, rotation: 0, spin: 0
}];
advanceFlight(movingRockFlight, 2000);
assert.ok(movingRockFlight.asteroids[0].x < .9, 'asteroids move independently of ship input');

const hitFlight = makeCollisionFlight();
const hit = advanceFlight(hitFlight, 2000, { hullIntegrity: 100 });
assert.ok(hit.newEvents.length >= 1, 'swept collision is detected across a movement step');
assert.ok(hit.hullIntegrity < 100, 'collision applies real hull damage');
assert.equal(hit.newEvents[0].damage, WORLD.hitDamage);
const afterHitCount = hitFlight.collisionSeq;
advanceFlight(hitFlight, 1500, { hullIntegrity: hit.hullIntegrity });
assert.equal(hitFlight.collisionSeq, afterHitCount, 'one continuous collision cannot repeat damage');

const shieldFlight = makeCollisionFlight();
const shieldHit = advanceFlight(shieldFlight, 2000, { hullIntegrity: 100, damageMultiplier: 0.5 });
assert.equal(shieldHit.hullIntegrity, 95, 'shields halve collision damage (rounded to whole points)');

const defenseFlight = makeCollisionFlight();
const defended = advanceFlight(defenseFlight, 2000, { hullIntegrity: 100, pointDefense: true });
assert.equal(defended.hullIntegrity, 100, 'point defense blocks one asteroid collision');
assert.equal(defended.consumedPointDefense, true);
assert.equal(defended.newEvents[0].blocked, true);

const breachFlight = makeCollisionFlight();
const breach = advanceFlight(breachFlight, 2000, { hullIntegrity: 5 });
assert.equal(breach.hullIntegrity, 0, 'collision damage cannot underflow hull');
assert.equal(breach.causeOfDeath, 'asteroid_collision');

const expiryFlight = makeCollisionFlight();
const expiry = advanceFlight(expiryFlight, 6000);
assert.equal(expiryFlight.collisionEvents.length, 0, 'old explosion events are removed');
assert.ok(expiry.newEvents.length >= 1);

console.log('Spaceflight tests passed (deterministic controls, bounds, asteroids, collisions, damage and event expiry).');
