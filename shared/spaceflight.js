((root) => {
'use strict';

const WORLD = Object.freeze({
  minX: 0.055,
  maxX: 0.945,
  minY: 0.09,
  maxY: 0.91,
  shipRadius: 0.038,
  maxShipSpeed: 0.36,
  forwardAcceleration: 0.34,
  brakeDeceleration: 0.58,
  shipDamping: 0.22,
  turnSpeed: 2.35,
  maxAsteroids: 8,
  maxEvents: 16,
  asteroidHealth: 3,
  weaponRange: 0.62,
  eventLifetimeMs: 4200,
  hitDamage: 9,
  maxAdvanceMs: 5000,
  substepMs: 40
});

function hashSeed(value) {
  let h = 2166136261;
  for (const char of String(value)) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0 || 1;
}

function nextRandom(flight) {
  let x = flight.rngState >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  flight.rngState = x >>> 0 || 1;
  return flight.rngState / 4294967296;
}

function makeAsteroid(flight, id, x) {
  const rand = nextRandom(flight);
  return {
    id: `rock_${id}`,
    shapeSeed: Math.floor(rand * 0x7fffffff),
    x,
    y: 0.12 + nextRandom(flight) * 0.76,
    vx: -(0.075 + nextRandom(flight) * 0.065),
    vy: (nextRandom(flight) - 0.5) * 0.035,
    radius: 0.023 + nextRandom(flight) * 0.019,
    health: WORLD.asteroidHealth,
    maxHealth: WORLD.asteroidHealth,
    damageMarks: [],
    rotation: nextRandom(flight) * Math.PI * 2,
    spin: (nextRandom(flight) - 0.5) * 1.4
  };
}

function createFlightState(seed, now = Date.now()) {
  const flight = {
    matchId: typeof seed === 'string' ? seed : null,
    rngState: hashSeed(seed),
    nextAsteroidId: 0,
    collisionSeq: 0,
    weaponSeq: 0,
    navigationSeq: 0,
    inputSequence: 0,
    lastTickAt: now,
    actionReceipts: [],
    ship: {
      x: 0.43,
      y: 0.52,
      vx: 0,
      vy: 0,
      inputX: 0,
      inputY: 0,
      radius: WORLD.shipRadius,
      // Screen coordinates: +X is right, +Y is down. Canvas ship art points
      // along native +X, so -PI/2 faces up and positive heading turns clockwise.
      heading: -Math.PI / 2,
      speed: 0,
      accelerationMultiplier: 1
    },
    asteroids: [],
    collisionEvents: [],
    weaponEvents: [],
    navigationEvents: []
  };

  for (let i = 0; i < WORLD.maxAsteroids; i++) {
    const x = 0.73 + (i / WORLD.maxAsteroids) * 0.48 + nextRandom(flight) * 0.08;
    flight.asteroids.push(makeAsteroid(flight, flight.nextAsteroidId++, x));
  }
  return flight;
}

function normalizeInput(inputX, inputY) {
  if (![inputX, inputY].every(value => Number.isInteger(value) && value >= -1 && value <= 1)) {
    throw new TypeError('Flight input components must be -1, 0, or 1');
  }
  const length = Math.hypot(inputX, inputY);
  return length > 1 ? { x: inputX / length, y: inputY / length } : { x: inputX, y: inputY };
}

function setFlightInput(flight, inputX, inputY, inputSequence, now) {
  if (!Number.isSafeInteger(inputSequence) || inputSequence < 1 || inputSequence <= (flight.inputSequence || 0)) return false;
  const input = normalizeInput(inputX, inputY);
  flight.ship.inputX = input.x;
  flight.ship.inputY = input.y;
  flight.inputSequence = inputSequence;
  flight.inputUpdatedAt = now;
  return true;
}

function advanceShip(ship, dt) {
  ship.heading = normalizeAngle(ship.heading + ship.inputX * WORLD.turnSpeed * dt);
  const throttle = -ship.inputY;
  if (throttle > 0) ship.speed += WORLD.forwardAcceleration * throttle * dt * clamp(ship.accelerationMultiplier || 1, .5, 1.8);
  else if (throttle < 0) ship.speed = Math.max(0, ship.speed + WORLD.brakeDeceleration * throttle * dt);
  else ship.speed *= Math.exp(-WORLD.shipDamping * dt);
  ship.speed = clamp(ship.speed, 0, WORLD.maxShipSpeed);
  ship.vx = Math.cos(ship.heading) * ship.speed;
  ship.vy = Math.sin(ship.heading) * ship.speed;
  ship.x = clamp(ship.x + ship.vx * dt, WORLD.minX, WORLD.maxX);
  ship.y = clamp(ship.y + ship.vy * dt, WORLD.minY, WORLD.maxY);
  return ship;
}

function predictShip(ship, elapsedMs) {
  const predicted = { ...ship };
  const elapsed = Math.min(WORLD.maxAdvanceMs, Math.max(0, elapsedMs));
  const steps = Math.ceil(elapsed / WORLD.substepMs);
  const dt = steps ? elapsed / steps / 1000 : 0;
  for (let step = 0; step < steps; step++) advanceShip(predicted, dt);
  return predicted;
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function armAsteroidHazard(flight, threatId) {
  if (!flight.asteroids.length) return null;
  const ship = flight.ship;
  const ahead = flight.asteroids.filter(asteroid => asteroid.x > ship.x + 0.08 && asteroid.vx < 0);
  const asteroid = ahead.sort((a, b) => ((a.x - ship.x) / -a.vx) - ((b.x - ship.x) / -b.vx))[0]
    || flight.asteroids.reduce((closest, item) =>
      Math.abs(item.x - ship.x) < Math.abs(closest.x - ship.x) ? item : closest);
  asteroid.x = Math.max(asteroid.x, Math.min(0.985, ship.x + 0.12));
  asteroid.y = clamp(ship.y, WORLD.minY + asteroid.radius, WORLD.maxY - asteroid.radius);
  asteroid.vx = -Math.max(0.095, Math.abs(asteroid.vx));
  asteroid.vy = 0;
  asteroid.threatId = threatId;
  return asteroid.id;
}

function divertAsteroidHazard(flight, threatId, now) {
  const index = flight.asteroids.findIndex(asteroid => asteroid.threatId === threatId);
  if (index < 0) return false;
  const asteroid = flight.asteroids[index];
  flight.navigationSeq = (flight.navigationSeq || 0) + 1;
  flight.navigationEvents = Array.isArray(flight.navigationEvents) ? flight.navigationEvents : [];
  flight.navigationEvents.push({
    id: `diversion_${flight.navigationSeq}`,
    matchId: flight.matchId || null,
    asteroidId: asteroid.id,
    x: asteroid.x,
    y: asteroid.y,
    at: now,
    kind: 'diverted'
  });
  flight.asteroids[index] = makeAsteroid(flight, flight.nextAsteroidId++, 1.04 + asteroid.radius);
  flight.navigationEvents = flight.navigationEvents.slice(-WORLD.maxEvents);
  return true;
}

function distanceToRelativeSegment(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(ax, ay);
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function getThreatRadar(flight, now = Date.now(), matchId = null) {
  const ship = flight?.ship;
  if (!ship) return { ship: null, targets: [], markedThreat: null };
  const horizonSeconds = 2.5;
  const targets = (flight.asteroids || []).map(asteroid => {
    const dx = asteroid.x - ship.x;
    const dy = asteroid.y - ship.y;
    const distance = Math.hypot(dx, dy);
    const relativeVx = asteroid.vx - (ship.vx || 0);
    const relativeVy = asteroid.vy - (ship.vy || 0);
    const closestApproach = distanceToRelativeSegment(
      dx, dy,
      dx + relativeVx * horizonSeconds,
      dy + relativeVy * horizonSeconds
    );
    const collisionRadius = (ship.radius || WORLD.shipRadius) + asteroid.radius;
    const threatLevel = closestApproach <= collisionRadius * 1.7
      ? 'high'
      : closestApproach <= Math.max(collisionRadius * 3, .12) ? 'watch' : 'low';
    return {
      asteroidId: asteroid.id,
      dx,
      dy,
      distance,
      direction: Math.atan2(dy, dx),
      threatLevel,
      marked: false
    };
  }).filter(target => target.distance <= .48)
    .sort((a, b) => a.distance - b.distance);

  let markedThreat = null;
  const mark = flight.navigatorMark;
  if (mark && mark.expiresAt > now && (!matchId || mark.matchId === matchId) &&
      flight.asteroids.some(asteroid => asteroid.id === mark.asteroidId)) {
    markedThreat = {
      asteroidId: mark.asteroidId,
      nickname: mark.nickname,
      expiresAt: mark.expiresAt
    };
    const target = targets.find(item => item.asteroidId === mark.asteroidId);
    if (target) target.marked = true;
  }

  return {
    ship: { heading: ship.heading },
    targets,
    markedThreat
  };
}

function advanceFlight(flight, now, options = {}) {
  if (flight.inputUpdatedAt && now - flight.inputUpdatedAt > 4500) {
    flight.ship.inputX = 0;
    flight.ship.inputY = 0;
    flight.ship.speed = 0;
    flight.ship.vx = 0;
    flight.ship.vy = 0;
  }
  let hullIntegrity = options.hullIntegrity ?? 100;
  let pointDefense = Boolean(options.pointDefense);
  const damageMultiplier = Number.isFinite(options.damageMultiplier)
    ? clamp(options.damageMultiplier, 0, 1) : 1;
  const tickStartedAt = flight.lastTickAt;
  const elapsedMs = Math.max(0, Math.min(WORLD.maxAdvanceMs, now - flight.lastTickAt));
  const steps = Math.max(1, Math.ceil(elapsedMs / WORLD.substepMs));
  const dt = elapsedMs / steps / 1000;
  const newEvents = [];

  for (let step = 0; step < steps && elapsedMs > 0; step++) {
    const previousShipX = flight.ship.x;
    const previousShipY = flight.ship.y;
    advanceShip(flight.ship, dt);

    for (let i = 0; i < flight.asteroids.length; i++) {
      const asteroid = flight.asteroids[i];
      const oldX = asteroid.x;
      const oldY = asteroid.y;
      asteroid.x += asteroid.vx * dt;
      asteroid.y += asteroid.vy * dt;
      asteroid.rotation += asteroid.spin * dt;

      const relativeDistance = distanceToRelativeSegment(
        previousShipX - oldX,
        previousShipY - oldY,
        flight.ship.x - asteroid.x,
        flight.ship.y - asteroid.y
      );
      if (relativeDistance <= flight.ship.radius + asteroid.radius) {
        flight.collisionSeq++;
        const damage = pointDefense ? 0 : Math.max(1, Math.round(WORLD.hitDamage * damageMultiplier));
        const normalLength = Math.max(1e-6, Math.hypot(flight.ship.x - asteroid.x, flight.ship.y - asteroid.y));
        const normalX = (flight.ship.x - asteroid.x) / normalLength;
        const normalY = (flight.ship.y - asteroid.y) / normalLength;
        const contactX = asteroid.x + normalX * asteroid.radius;
        const contactY = asteroid.y + normalY * asteroid.radius;
        const event = {
          id: `impact_${flight.collisionSeq}`,
          matchId: flight.matchId || null,
          asteroidId: asteroid.id,
          asteroidThreatId: asteroid.threatId || null,
          x: contactX,
          y: contactY,
          shipX: flight.ship.x - normalX * flight.ship.radius,
          shipY: flight.ship.y - normalY * flight.ship.radius,
          normalX,
          normalY,
          at: tickStartedAt + (step + 1) * dt * 1000,
          damage,
          blocked: pointDefense
        };
        newEvents.push(event);
        flight.collisionEvents.push(event);
        pointDefense = false;
        hullIntegrity = Math.max(0, hullIntegrity - damage);

        flight.asteroids[i] = makeAsteroid(flight, flight.nextAsteroidId++, 1.04 + asteroid.radius);
        if (hullIntegrity <= 0) break;
        continue;
      }

      if (asteroid.x < -0.09 || asteroid.y < -0.08 || asteroid.y > 1.08) {
        flight.asteroids[i] = makeAsteroid(flight, flight.nextAsteroidId++, 1.04 + asteroid.radius);
      }
    }
    if (hullIntegrity <= 0) break;
  }

  flight.lastTickAt = now;
  flight.collisionEvents = flight.collisionEvents
    .filter(event => now - event.at <= WORLD.eventLifetimeMs)
    .slice(-WORLD.maxEvents);
  flight.navigationEvents = (flight.navigationEvents || [])
    .filter(event => now - event.at <= WORLD.eventLifetimeMs)
    .slice(-WORLD.maxEvents);
  flight.weaponEvents = (flight.weaponEvents || [])
    .filter(event => now - event.at <= WORLD.eventLifetimeMs)
    .slice(-WORLD.maxEvents);

  return {
    hullIntegrity,
    causeOfDeath: hullIntegrity <= 0 && newEvents.length ? 'asteroid_collision' : null,
    consumedPointDefense: Boolean(options.pointDefense) && !pointDefense,
    newEvents
  };
}

function resolvePulseCannonHit(flight, asteroidId, now, matchId) {
  const asteroidIndex = flight.asteroids.findIndex(item => item.id === asteroidId);
  if (asteroidIndex < 0) return { error: 'That asteroid is no longer in this match.' };
  const asteroid = flight.asteroids[asteroidIndex];
  const dx = asteroid.x - flight.ship.x;
  const dy = asteroid.y - flight.ship.y;
  const distance = Math.hypot(dx, dy);
  if (distance > WORLD.weaponRange) return { error: 'That asteroid is outside pulse-cannon range.' };

  flight.weaponSeq = (flight.weaponSeq || 0) + 1;
  asteroid.maxHealth = Number.isFinite(asteroid.maxHealth) ? asteroid.maxHealth : WORLD.asteroidHealth;
  asteroid.health = Number.isFinite(asteroid.health) ? asteroid.health : asteroid.maxHealth;
  asteroid.damageMarks = Array.isArray(asteroid.damageMarks) ? asteroid.damageMarks : [];
  const healthBefore = Math.max(1, asteroid.health);
  const healthAfter = 0;
  const destroyed = true;
  const impactX = asteroid.x - (dx / Math.max(distance, 1e-6)) * asteroid.radius;
  const impactY = asteroid.y - (dy / Math.max(distance, 1e-6)) * asteroid.radius;
  const event = {
    id: `shot_${flight.weaponSeq}`,
    matchId: matchId || flight.matchId || null,
    at: now,
    asteroidId,
    fromX: flight.ship.x,
    fromY: flight.ship.y,
    impactX,
    impactY,
    damage: healthBefore,
    healthBefore,
    maxHealth: asteroid.maxHealth,
    healthAfter,
    destroyed
  };
  asteroid.health = healthAfter;
  const offsetX = impactX - asteroid.x;
  const offsetY = impactY - asteroid.y;
  const cosine = Math.cos(asteroid.rotation || 0);
  const sine = Math.sin(asteroid.rotation || 0);
  asteroid.damageMarks.push({
    u: (offsetX * cosine + offsetY * sine) / asteroid.radius,
    v: (-offsetX * sine + offsetY * cosine) / asteroid.radius,
    eventId: event.id,
    at: now
  });
  asteroid.damageMarks = asteroid.damageMarks.slice(-4);
  if (destroyed) {
    flight.asteroids.splice(asteroidIndex, 1);
    flight.asteroids.push(makeAsteroid(flight, flight.nextAsteroidId++, 1.04 + asteroid.radius));
  }
  flight.weaponEvents = Array.isArray(flight.weaponEvents) ? flight.weaponEvents : [];
  flight.weaponEvents.push(event);
  flight.weaponEvents = flight.weaponEvents.slice(-WORLD.maxEvents);
  return { event, destroyed, asteroidId };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const api = {
  WORLD,
  createFlightState,
  normalizeInput,
  setFlightInput,
  advanceShip,
  predictShip,
  normalizeAngle,
  armAsteroidHazard,
  divertAsteroidHazard,
  getThreatRadar,
  resolvePulseCannonHit,
  advanceFlight
};
if (root) root.Spaceflight = api;
if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
