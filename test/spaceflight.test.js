'use strict';

const assert = require('node:assert/strict');
const {
  WORLD, createFlightState, normalizeInput, normalizeAngle, advanceFlight,
  predictShip, armAsteroidHazard, divertAsteroidHazard, getThreatRadar,
  launchPulseCannonProjectile, sweptCircleImpact
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
assert.equal(WORLD.projectileSpeed, .6, 'Pulse Cannon configured speed is 2.5 times its prior .24 world-unit speed');
const exactContact = sweptCircleImpact(
  { x: .3, y: .5 }, { x: .7, y: .5 }, { x: .5, y: .5 }, { x: .5, y: .5 }, .06
);
assert.ok(Math.abs(exactContact - .35) < 1e-12, 'swept-circle collision reports first contact, before the center/closest point');
assert.ok(exactContact < .5, 'projectile collision is registered before the projectile passes the asteroid center');
assert.equal(sweptCircleImpact({ x: .3, y: .2 }, { x: .7, y: .2 }, { x: .5, y: .5 }, { x: .5, y: .5 }, .06), null,
  'swept-circle collision rejects a segment that misses the asteroid');
const weaponFlight = createFlightState('weapon-seed', 1000);
weaponFlight.ship.x = .4; weaponFlight.ship.y = .5;
weaponFlight.asteroids = [{ id: 'rock_target', shapeSeed: 45, x: .6, y: .5, vx: 0, vy: 0, radius: .03,
  rotation: .2, spin: 0, health: 9, maxHealth: 9, damageMarks: [] }];
assert.equal(launchPulseCannonProjectile(weaponFlight, 'rock_missing', 'gunner-1', 1200, 'weapon-match').error, 'That asteroid is no longer in this match.');
weaponFlight.asteroids[0].x = 1.1;
assert.equal(launchPulseCannonProjectile(weaponFlight, 'rock_target', 'gunner-1', 1250, 'weapon-match').error, 'That asteroid is outside pulse-cannon range.');
weaponFlight.asteroids[0].x = .6;
weaponFlight.lastTickAt = 1300;
const launchedShot = launchPulseCannonProjectile(weaponFlight, 'rock_target', 'gunner-1', 1300, 'weapon-match');
assert.equal(launchedShot.error, undefined);
assert.equal(launchedShot.destroyed, false, 'accepting FIRE launches a projectile but does not destroy its target');
assert.equal(weaponFlight.asteroids.some(rock => rock.id === 'rock_target'), true, 'selected asteroid remains during projectile travel');
assert.equal(weaponFlight.asteroids.length, 1, 'launching a projectile does not replace any asteroid');
assert.equal(weaponFlight.projectiles.length, 1, 'accepted FIRE creates one authoritative projectile');
assert.ok(Math.abs(launchedShot.projectile.speed - WORLD.projectileSpeed) < 1e-12,
  'the projectile uses the configured faster speed');
assert.equal(weaponFlight.weaponEvents[0].destroyed, false, 'launch event is not an impact event');
advanceFlight(weaponFlight, 1400);
assert.equal(weaponFlight.asteroids.some(rock => rock.id === 'rock_target'), true, 'target remains alive while the bolt is travelling');
assert.equal(weaponFlight.projectiles.length, 1, 'projectile position remains authoritative between polls');
advanceFlight(weaponFlight, 1500);
assert.equal(weaponFlight.asteroids.some(rock => rock.id === 'rock_target'), true, 'a distant muzzle-to-target path remains in flight until first contact');
const confirmedImpactTick = advanceFlight(weaponFlight, 1650);
assert.equal(confirmedImpactTick.weaponImpacts.length, 1,
  'the first update containing first contact returns the confirmed impact without a follow-up simulation tick');
assert.equal(weaponFlight.asteroids.some(rock => rock.id === 'rock_target'), false, 'target is removed only after swept projectile collision');
assert.equal(weaponFlight.asteroids.length, 1, 'collision replaces only the struck asteroid');
assert.notEqual(weaponFlight.asteroids[0].id, 'rock_target', 'replacement asteroid has a new identity');
assert.equal(weaponFlight.projectiles.length, 1, 'completed projectile is retained in the bounded match event window');
assert.equal(weaponFlight.projectiles[0].active, false, 'confirmed collision deactivates the projectile');
assert.equal(weaponFlight.projectiles[0].destroyed, true, 'projectile state records confirmed destruction');
assert.equal(weaponFlight.weaponEvents[0].destroyed, true, 'impact mutates the stable shot event to confirmed destruction');
assert.ok(Number.isFinite(weaponFlight.weaponEvents[0].impactAt), 'collision records its authoritative impact timestamp');
assert.ok(Math.abs(Math.hypot(weaponFlight.weaponEvents[0].impactX - .6, weaponFlight.weaponEvents[0].impactY - .5) - .038) < 1e-10,
  'impact position is the projectile center at the exact combined-radius contact point');
assert.ok(weaponFlight.weaponEvents[0].impactAt >= 1300 && weaponFlight.weaponEvents[0].impactAt <= 1650,
  'impact timestamp stays within the simulation update that confirmed first contact');

const delayedPollFlight = createFlightState('weapon-delayed-poll', 1000);
delayedPollFlight.ship.x = .4; delayedPollFlight.ship.y = .5; delayedPollFlight.ship.heading = 0;
delayedPollFlight.asteroids = [{ id: 'rock_delayed_poll', x: .6, y: .5, vx: 0, vy: 0, radius: .03, health: 3, maxHealth: 3 }];
const launchAt = 1300;
const delayedLaunch = launchPulseCannonProjectile(delayedPollFlight, 'rock_delayed_poll', 'gunner-1', launchAt, 'weapon-match');
const fireRequestTick = advanceFlight(delayedPollFlight, launchAt);
assert.equal(fireRequestTick.weaponImpacts.length, 0, 'the FIRE request tick cannot simulate the new shot through time before it was launched');
assert.equal(delayedLaunch.projectile.x, delayedLaunch.projectile.fromX, 'shot begins at the muzzle on the FIRE update');
assert.equal(delayedLaunch.projectile.active, true, 'shot remains in flight after catch-up time preceding launch');
assert.equal(delayedPollFlight.asteroids.some(rock => rock.id === 'rock_delayed_poll'), true,
  'catching up the room tick does not destroy the target before the new projectile has travelled');

const missFlight = createFlightState('weapon-miss', 1000);
missFlight.ship.x = .4; missFlight.ship.y = .5; missFlight.ship.heading = 0;
missFlight.asteroids = [{ id: 'rock_miss', x: .6, y: .5, vx: 0, vy: 0, radius: .03, health: 3, maxHealth: 3 }];
launchPulseCannonProjectile(missFlight, 'rock_miss', 'gunner-1', 1000, 'weapon-match');
missFlight.projectiles[0].vy = .4;
missFlight.projectiles[0].vx = 0;
advanceFlight(missFlight, 5000);
assert.equal(missFlight.asteroids.some(rock => rock.id === 'rock_miss'), true, 'a projectile that misses leaves the target alive');
assert.equal(missFlight.weaponEvents[0].destroyed, false);
assert.equal(missFlight.weaponEvents[0].missed, true, 'a missed projectile expires without a destruction event');
assert.equal(missFlight.projectiles[0].active, false);
assert.equal(missFlight.projectiles[0].destroyed, false);

const sweptFlight = createFlightState('weapon-swept', 1000);
sweptFlight.ship.x = .2; sweptFlight.ship.y = .5; sweptFlight.ship.heading = 0;
sweptFlight.asteroids = [
  { id: 'rock_decoy', x: .39, y: .5, vx: 0, vy: 0, radius: .02, health: 3, maxHealth: 3 },
  { id: 'rock_swept', x: .5, y: .5, vx: 0, vy: 0, radius: .02, health: 3, maxHealth: 3 }
];
launchPulseCannonProjectile(sweptFlight, 'rock_swept', 'gunner-1', 1000, 'weapon-match');
sweptFlight.projectiles[0].vx = 12;
sweptFlight.projectiles[0].vy = 0;
advanceFlight(sweptFlight, 1040);
assert.equal(sweptFlight.asteroids.some(rock => rock.id === 'rock_swept'), false, 'swept collision catches a fast projectile crossing an asteroid within one substep');
assert.equal(sweptFlight.asteroids.some(rock => rock.id === 'rock_decoy'), true, 'shot collision only destroys its selected asteroid');
assert.ok(sweptFlight.weaponEvents[0].impactX < .5, 'fast projectile stops at first contact instead of passing through to closest approach');
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
