'use strict';

// ════════════════════════════════════════════════════════════════════════════
// Signal Shift: Survive Together — Shared Game Rules
// Imported by: netlify/functions/game.js
// DO NOT import browser APIs here. Pure logic only.
// ════════════════════════════════════════════════════════════════════════════

// ── Constants ────────────────────────────────────────────────────────────────
const ROUND_DURATION_MS      = 90_000;
const MAX_PLAYERS            = 6;
const MIN_PLAYERS_TO_START   = 2;
const INITIAL_HULL           = 100;
const DISCONNECT_TIMEOUT_MS  = 10_000;
const ROOM_CODE_CHARS        = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // excludes I O 0 1 and digits
const MAX_ACTIVE_EMERGENCIES = 3;
const TUTORIAL_EMERGENCY_MS  = 15_000; // first guaranteed emergency at 15 s

// ── Role Definitions ─────────────────────────────────────────────────────────
const ROLES = [
  {
    id: 'engineer',
    name: 'Engineer',
    icon: '🔧',
    color: '#f59e0b',
    description: 'Master of repairs. Can fix any ship system as a fallback.',
    abilities: [
      {
        id: 'patch_hull',
        name: 'Patch Hull',
        icon: '🛠️',
        description: 'Restore 15 hull integrity',
        cooldownMs: 8000
      },
      {
        id: 'boost_shields',
        name: 'Boost Shields',
        icon: '🛡️',
        description: 'Reduce all incoming damage by 50% for 10 seconds',
        cooldownMs: 25000
      }
    ]
  },
  {
    id: 'navigator',
    name: 'Navigator',
    icon: '🧭',
    color: '#3b82f6',
    description: 'Guides the ship through hazards and spatial anomalies.',
    abilities: [
      {
        id: 'evade',
        name: 'Evasive Maneuver',
        icon: '↗️',
        description: 'Cancel an active asteroid or navigation emergency',
        cooldownMs: 12000
      },
      {
        id: 'chart_course',
        name: 'Chart Course',
        icon: '🗺️',
        description: 'Prevent navigation failures for 15 seconds',
        cooldownMs: 30000
      }
    ]
  },
  {
    id: 'systems_officer',
    name: 'Systems Officer',
    icon: '⚡',
    color: '#8b5cf6',
    description: 'Controls ship power distribution and subsystem routing.',
    abilities: [
      {
        id: 'reroute_power',
        name: 'Reroute Power',
        icon: '🔌',
        description: 'Instantly resolve an active power surge emergency',
        cooldownMs: 18000
      },
      {
        id: 'emergency_broadcast',
        name: 'Emergency Broadcast',
        icon: '📡',
        description: 'Preview the next emergency 8 seconds in advance',
        cooldownMs: 35000
      }
    ]
  },
  {
    id: 'medic',
    name: 'Medic',
    icon: '💊',
    color: '#10b981',
    description: 'Keeps the crew operational under pressure.',
    abilities: [
      {
        id: 'stabilize',
        name: 'Stabilize',
        icon: '❤️',
        description: 'Prevent life-support hull damage for 20 seconds',
        cooldownMs: 22000
      },
      {
        id: 'triage',
        name: 'Triage',
        icon: '⏩',
        description: 'Reduce all active ability cooldowns by 4 seconds',
        cooldownMs: 40000
      }
    ]
  },
  {
    id: 'gunner',
    name: 'Gunner',
    icon: '🎯',
    color: '#ef4444',
    description: 'Eliminates external threats with precision firepower.',
    abilities: [
      {
        id: 'counter_blast',
        name: 'Counter Blast',
        icon: '💥',
        description: 'Destroy an asteroid or radiation threat — gain +50 score',
        cooldownMs: 15000
      },
      {
        id: 'point_defense',
        name: 'Point Defense',
        icon: '🎖️',
        description: 'Automatically block the next asteroid impact',
        cooldownMs: 45000
      }
    ]
  },
  {
    id: 'commander',
    name: 'Commander',
    icon: '⭐',
    color: '#f97316',
    description: 'Inspires the crew to peak performance when it matters most.',
    abilities: [
      {
        id: 'all_hands',
        name: 'All Hands',
        icon: '✊',
        description: 'Halve all ability cooldowns for 10 seconds',
        cooldownMs: 50000
      },
      {
        id: 'priority_override',
        name: 'Priority Override',
        icon: '🚨',
        description: 'Instantly resolve any one active emergency',
        cooldownMs: 60000
      }
    ]
  }
];

// ── Emergency Type Definitions ───────────────────────────────────────────────
const EMERGENCY_TYPES = [
  {
    id: 'engine_fire',
    name: 'Engine Fire',
    icon: '🔥',
    description: 'The engine is on fire! Power failing.',
    damagePerSec: 3,
    damageOnExpiry: 0,
    resolveRole: 'engineer',
    altRole: null,
    fallbackToEngineer: true,
    timeWindowMs: 20000,
    tutorialFriendly: true,
    baseSeverity: 1
  },
  {
    id: 'hull_breach',
    name: 'Hull Breach',
    icon: '💥',
    description: 'Hull integrity compromised — seal the breach!',
    damagePerSec: 5,
    damageOnExpiry: 0,
    resolveRole: 'engineer',
    altRole: null,
    fallbackToEngineer: true,
    timeWindowMs: 15000,
    tutorialFriendly: false,
    baseSeverity: 2
  },
  {
    id: 'oxygen_leak',
    name: 'Oxygen Leak',
    icon: '💨',
    description: 'Oxygen reserves depleting fast!',
    damagePerSec: 2,
    damageOnExpiry: 0,
    resolveRole: 'medic',
    altRole: null,
    fallbackToEngineer: true,
    timeWindowMs: 20000,
    tutorialFriendly: true,
    baseSeverity: 1
  },
  {
    id: 'nav_failure',
    name: 'Navigation Failure',
    icon: '🧭',
    description: 'Navigation systems are offline!',
    damagePerSec: 1,
    damageOnExpiry: 5,
    resolveRole: 'navigator',
    altRole: null,
    fallbackToEngineer: true,
    timeWindowMs: 22000,
    tutorialFriendly: true,
    baseSeverity: 1
  },
  {
    id: 'rogue_asteroid',
    name: 'Rogue Asteroid',
    icon: '☄️',
    description: 'Asteroid on collision course! Evade or blast it!',
    damagePerSec: 0,
    damageOnExpiry: 12,
    resolveRole: 'navigator',
    altRole: 'gunner',
    fallbackToEngineer: true,
    timeWindowMs: 12000,
    tutorialFriendly: false,
    baseSeverity: 2
  },
  {
    id: 'power_surge',
    name: 'Power Surge',
    icon: '⚡',
    description: 'Uncontrolled power surge through ship systems!',
    damagePerSec: 2,
    damageOnExpiry: 8,
    resolveRole: 'systems_officer',
    altRole: null,
    fallbackToEngineer: true,
    timeWindowMs: 18000,
    tutorialFriendly: false,
    baseSeverity: 2
  },
  {
    id: 'radiation_burst',
    name: 'Radiation Burst',
    icon: '☢️',
    description: 'Radiation levels critical — all hands respond!',
    damagePerSec: 4,
    damageOnExpiry: 0,
    resolveRole: null, // any player can resolve
    altRole: null,
    fallbackToEngineer: false,
    timeWindowMs: 15000,
    tutorialFriendly: false,
    baseSeverity: 3
  }
];

// ── Seeded LCG Random Number Generator ──────────────────────────────────────
function createRng(seed) {
  let s = Math.abs(Math.floor(seed)) % 2147483647;
  if (s <= 0) s = 1;
  return function next() {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646; // [0, 1)
  };
}

// ── Generate Emergency Schedule ──────────────────────────────────────────────
// Pre-computes the full spawn schedule at game start.
// First 20 s: one guaranteed tutorial emergency.
// After 20 s: Poisson-distributed emergencies, accelerating over the round.
function generateEmergencySchedule(startedAt, playerCount, roleIds) {
  const rng = createRng(startedAt % 2147483647);
  const schedule = [];

  // Tutorial window — pick a simple, role-appropriate emergency
  const tutorialPool = EMERGENCY_TYPES.filter(e => e.tutorialFriendly);
  const tutorialPick = tutorialPool[Math.floor(rng() * tutorialPool.length)];
  schedule.push({
    id: 'em_tutorial',
    spawnAt: startedAt + TUTORIAL_EMERGENCY_MS,
    typeId: tutorialPick.id,
    severity: 1
  });

  // Chaos phase — accelerating Poisson schedule
  // Only include types resolvable by the present roles (via direct or fallback)
  const usable = EMERGENCY_TYPES.filter(def => {
    if (!def.resolveRole) return true;
    if (roleIds.includes(def.resolveRole)) return true;
    if (def.altRole && roleIds.includes(def.altRole)) return true;
    if (def.fallbackToEngineer && roleIds.includes('engineer')) return true;
    return false;
  });

  let t = startedAt + 20000;
  const endTime = startedAt + ROUND_DURATION_MS - 8000;
  let counter = 0;

  while (t < endTime && schedule.length < 30) {
    counter++;
    const progress = Math.min(1.0, (t - startedAt) / ROUND_DURATION_MS);
    const meanMs = 15000 - progress * 7000; // 15 s → 8 s
    const u = Math.max(0.001, rng());
    const interArrival = Math.max(5000, -meanMs * Math.log(u));
    t += interArrival;
    if (t >= endTime) break;

    const pick = usable[Math.floor(rng() * usable.length)];
    const severity = progress < 0.4 ? 1
                   : progress < 0.7 ? Math.min(pick.baseSeverity, 2)
                   : pick.baseSeverity;

    schedule.push({
      id: `em_${counter}_${Math.floor(rng() * 99999)}`,
      spawnAt: Math.floor(t),
      typeId: pick.id,
      severity
    });
  }

  return schedule;
}

// ── Role Assignment ───────────────────────────────────────────────────────────
// Assigns roles in join order. Players beyond ROLES.length get role[0] (Engineer).
function assignRoles(players) {
  return players.map((p, i) => ({
    ...p,
    role: ROLES[Math.min(i, ROLES.length - 1)].id
  }));
}

// ── Can Role Resolve Emergency ────────────────────────────────────────────────
function canRoleResolve(roleId, emergency) {
  const def = EMERGENCY_TYPES.find(e => e.id === emergency.typeId);
  if (!def) return false;
  if (!def.resolveRole) return true;               // any player
  if (def.resolveRole === roleId) return true;
  if (def.altRole === roleId) return true;
  if (def.fallbackToEngineer && roleId === 'engineer') return true;
  return false;
}

// ── Buff Helpers ──────────────────────────────────────────────────────────────
function isBuffActive(round, buffId) {
  const now = Date.now();
  return (round.activeBuffs || []).some(b => b.id === buffId && b.expiresAt > now);
}

function addBuff(round, buffId, durationMs) {
  round.activeBuffs = (round.activeBuffs || []).filter(b => b.id !== buffId);
  round.activeBuffs.push({ id: buffId, expiresAt: Date.now() + durationMs });
}

function pruneBuffs(round) {
  const now = Date.now();
  round.activeBuffs = (round.activeBuffs || []).filter(b => b.expiresAt > now);
}

// ── Tick Game State ───────────────────────────────────────────────────────────
// Lazily applies time-based damage, spawns due emergencies, handles expiry.
// Must be called on every server request while phase === 'playing'.
function tickGameState(room, now) {
  if (room.phase !== 'playing' || !room.round) return room;

  const round = room.round;
  const elapsed   = now - round.startedAt;
  const lastTick  = round.lastTickAt || round.startedAt;
  const deltaSec  = Math.max(0, (now - lastTick) / 1000);

  pruneBuffs(round);

  const shieldActive = isBuffActive(round, 'boost_shields');
  const dmgMult = shieldActive ? 0.5 : 1.0;

  // ── Spawn due emergencies ──────────────────────────────────────
  const knownIds = new Set([
    ...round.activeEmergencies.map(e => e.id),
    ...(round.resolvedEmergencies || []).map(e => e.id)
  ]);
  const activeUnresolved = round.activeEmergencies.filter(e => !e.resolvedAt).length;

  for (const item of round.schedule) {
    if (item.spawnAt <= now && !knownIds.has(item.id)) {
      if (activeUnresolved < MAX_ACTIVE_EMERGENCIES) {
        const def = EMERGENCY_TYPES.find(e => e.id === item.typeId);
        round.activeEmergencies.push({
          id: item.id,
          typeId: item.typeId,
          severity: item.severity,
          spawnedAt: item.spawnAt,
          expiresAt: item.spawnAt + (def ? def.timeWindowMs : 15000),
          resolvedAt: null,
          resolvedBy: null,
          resolvedByNickname: null
        });
        knownIds.add(item.id);
      }
    }
  }

  // ── Apply continuous damage ────────────────────────────────────
  let totalDmg = 0;
  for (const em of round.activeEmergencies) {
    if (em.resolvedAt) continue;
    const def = EMERGENCY_TYPES.find(e => e.id === em.typeId);
    if (!def || def.damagePerSec <= 0) continue;
    if (em.typeId === 'oxygen_leak' && isBuffActive(round, 'stabilize')) continue;
    totalDmg += def.damagePerSec * deltaSec * dmgMult;
  }
  if (totalDmg > 0) {
    const newHull = Math.max(0, round.hullIntegrity - totalDmg);
    // Record cause of death if hull reaches zero due to damage
    if (newHull <= 0 && !round.causeOfDeath) {
      const active = round.activeEmergencies.find(e => !e.resolvedAt);
      round.causeOfDeath = active ? active.typeId : 'unknown';
    }
    round.hullIntegrity = newHull;
  }

  // ── Handle expiry & cleanup ────────────────────────────────────
  const stillActive = [];
  round.resolvedEmergencies = round.resolvedEmergencies || [];

  for (const em of round.activeEmergencies) {
    if (!em.resolvedAt && em.expiresAt <= now) {
      // Expired unresolved — apply expiry damage
      const def = EMERGENCY_TYPES.find(e => e.id === em.typeId);
      if (def && def.damageOnExpiry > 0) {
        round.hullIntegrity = Math.max(0, round.hullIntegrity - def.damageOnExpiry * dmgMult);
        round.causeOfDeath = em.typeId;
      }
      round.resolvedEmergencies.push({ ...em, expiredAt: now, expired: true });
    } else if (em.resolvedAt && now - em.resolvedAt > 4000) {
      // Resolved long enough — move to history
      round.resolvedEmergencies.push(em);
    } else {
      stillActive.push(em);
    }
  }
  round.activeEmergencies = stillActive;

  round.hullIntegrity = Math.max(0, round.hullIntegrity);
  round.lastTickAt = now;

  // ── Win / Lose check ──────────────────────────────────────────
  if (round.hullIntegrity <= 0) return _endRound(room, now, 'lose');
  if (elapsed >= round.duration)  return _endRound(room, now, 'win');

  return room;
}

function _endRound(room, now, outcome) {
  const round = room.round;
  const survivedSeconds = Math.min(90, Math.floor((now - round.startedAt) / 1000));

  let finalScore;
  if (outcome === 'win') {
    const remaining = Math.max(0, 90 - survivedSeconds);
    finalScore = 1000
      + remaining * 10
      + Math.floor(round.hullIntegrity) * 5
      + (round.emergenciesResolved || 0) * 75
      + (round.speedBonuses || 0) * 25;
  } else {
    finalScore = Math.max(0,
      Math.floor(round.hullIntegrity) * 5
      + (round.emergenciesResolved || 0) * 75
      + (round.speedBonuses || 0) * 25
    );
  }

  room.phase = 'results';
  round.outcome          = outcome;
  round.survivedSeconds  = survivedSeconds;
  round.finalScore       = Math.floor(finalScore);
  round.endedAt          = now;
  return room;
}

// ── ID Generation ─────────────────────────────────────────────────────────────
function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

function generatePlayerId() {
  return 'p_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now().toString(36);
}

// ── Module Exports ────────────────────────────────────────────────────────────
module.exports = {
  ROUND_DURATION_MS,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  INITIAL_HULL,
  DISCONNECT_TIMEOUT_MS,
  MAX_ACTIVE_EMERGENCIES,
  ROLES,
  EMERGENCY_TYPES,
  generateRoomCode,
  generatePlayerId,
  generateEmergencySchedule,
  assignRoles,
  canRoleResolve,
  tickGameState,
  isBuffActive,
  addBuff,
  pruneBuffs
};
