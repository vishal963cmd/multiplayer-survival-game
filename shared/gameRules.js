'use strict';

const { randomBytes, randomInt } = require('node:crypto');
const { createFlightState, advanceFlight, armAsteroidHazard } = require('./spaceflight');

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
const COOPERATIVE_EMERGENCY_TARGET = 3;
const COOPERATIVE_CREW_TARGET = 2;

// ── Role Definitions ─────────────────────────────────────────────────────────
const ROLES = [
  {
    id: 'pilot', name: 'Pilot', icon: '🛸', color: '#67e8f9',
    description: 'Steer the shared ship with WASD or the arrow keys.', abilities: []
  },
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
        id: 'pulse_cannon',
        name: 'Pulse Cannon',
        icon: '☄️',
        description: 'Aim at a real asteroid and fire. One precise shot destroys the selected rock.',
        cooldownMs: 1800
      },
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
  },
  {
    id: 'power_operator', name: 'Power Systems Operator', icon: '⚡', color: '#facc15',
    description: 'Route power to engines, shields, and weapons.',
    abilities: [
      { id: 'allocate_power', name: 'Route Power', icon: '🔋', description: 'Distribute the 100-point power budget across ship systems.', cooldownMs: 1000 },
      { id: 'boost_engines', name: 'Engine Overdrive', icon: '🚀', description: 'Boost shared ship acceleration for 8 seconds.', cooldownMs: 25000 }
    ]
  },
  {
    id: 'communications_officer', name: 'Communications Officer', icon: '📡', color: '#c084fc',
    description: 'Decode and confirm the crew’s incoming signal.',
    abilities: [
      { id: 'decode_signal', name: 'Decode Signal', icon: '🔐', description: 'Submit the active signal code before its deadline.', cooldownMs: 0 }
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
  // A guaranteed navigator-response event creates a real shared flight hazard.
  // The game tick marks one approaching asteroid for this emergency.
  schedule.push({
    id: 'em_rogue_asteroid',
    spawnAt: startedAt + 40000,
    typeId: 'rogue_asteroid',
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

  // Keep the default-length match from occasionally producing a nearly empty
  // encounter list when the seeded Poisson draws happen to be unusually sparse.
  // The guaranteed tutorial encounter plus these deterministic fallbacks make
  // the minimum gameplay cadence stable without changing denser schedules.
  const fallbackTimes = [startedAt + 30000, startedAt + 45000];
  for (const spawnAt of fallbackTimes) {
    if (schedule.length >= 3 || spawnAt >= endTime) break;
    const pick = usable[schedule.length % usable.length];
    schedule.push({
      id: `em_min_${schedule.length}`,
      spawnAt,
      typeId: pick.id,
      severity: 1
    });
  }
  schedule.sort((a, b) => a.spawnAt - b.spawnAt);

  return schedule;
}

// ── Role Assignment ───────────────────────────────────────────────────────────
function assignRoles(players, hostId = players[0]?.id) {
  const roleOrder = [...players].sort((a, b) => Number(b.id === hostId) - Number(a.id === hostId));
  const assignments = {
    2: [['pilot', 'engineer'], ['navigator', 'gunner']],
    3: [['pilot'], ['engineer'], ['navigator', 'gunner']],
    4: [['pilot'], ['engineer'], ['navigator'], ['gunner']],
    5: [['pilot'], ['engineer'], ['navigator'], ['gunner'], ['power_operator']],
    6: [['pilot'], ['engineer'], ['navigator'], ['gunner'], ['power_operator'], ['communications_officer']]
  }[players.length];
  if (!assignments) return roleOrder.map(p => ({ ...p, role: null, roles: [] }));
  return roleOrder.map((p, i) => {
    const roles = assignments[i];
    return { ...p, role: roles[0], roles: [...roles] };
  });
}

// ── Can Role Resolve Emergency ────────────────────────────────────────────────
function canRoleResolve(roleId, emergency) {
  const def = EMERGENCY_TYPES.find(e => e.id === emergency.typeId);
  if (!def) return false;
  if (!def.resolveRole) return true;               // any player
  const roles = Array.isArray(roleId) ? roleId : [roleId];
  if (roles.includes(def.resolveRole)) return true;
  if (roles.includes(def.altRole)) return true;
  if (def.fallbackToEngineer && roles.includes('engineer')) return true;
  return false;
}

// ── Buff Helpers ──────────────────────────────────────────────────────────────
function isBuffActive(round, buffId, now = Date.now()) {
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
  round.resolvedEmergencies = round.resolvedEmergencies || [];

  pruneBuffs(round);

  const shieldActive = isBuffActive(round, 'boost_shields', now);
  const shieldPower = round.power?.allocations?.shields || 0;
  const dmgMult = (shieldActive ? 0.5 : 1.0) * (1 - shieldPower * 0.003);
  if (round.communicationTask && !round.communicationTask.completedAt && now >= round.communicationTask.expiresAt) {
    round.communicationTask.expiredAt = round.communicationTask.expiredAt || now;
  }

  if (round.flight) {
    const enginePower = round.power?.allocations?.engines ?? 34;
    round.flight.ship.accelerationMultiplier = isBuffActive(round, 'engine_overdrive', now)
      ? 1.65 : 0.55 + enginePower * 0.009;
    const flightTick = advanceFlight(round.flight, now, {
      hullIntegrity: round.hullIntegrity,
      damageMultiplier: dmgMult,
      pointDefense: isBuffActive(round, 'point_defense', now)
    });
    round.hullIntegrity = flightTick.hullIntegrity;
    if (flightTick.consumedPointDefense) {
      round.activeBuffs = (round.activeBuffs || []).filter(buff => buff.id !== 'point_defense');
    }
    if (flightTick.causeOfDeath && !round.causeOfDeath) round.causeOfDeath = flightTick.causeOfDeath;
    for (const event of flightTick.newEvents) {
      const eventMatchId = event.matchId || round.matchId || room.matchId || 'match';
      const impactAction = {
        playerId: null,
        nickname: 'Flight Control',
        abilityId: 'flight_event',
        abilityName: event.damage > 0 ? 'Asteroid impact' : 'Point defense',
        timestamp: event.at,
        eventId: `${eventMatchId}:${event.id}`,
        message: event.damage > 0
          ? `Asteroid impact — hull −${event.damage}%`
          : 'Point defense blocked an asteroid impact.'
      };
      round.lastAction = impactAction;
      recordCrewEvent(round, { ...impactAction, id: `impact:${impactAction.eventId}`, type: 'collision' });
      if (!event.asteroidThreatId) continue;
      const threat = round.activeEmergencies.find(em => em.id === event.asteroidThreatId && !em.resolvedAt);
      if (!threat) continue;
      threat.failedAt = event.at;
      threat.failureReason = 'impact';
      round.resolvedEmergencies.push({ ...threat, failed: true });
      round.activeEmergencies = round.activeEmergencies.filter(em => em.id !== threat.id);
    }
  }

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
        if (item.typeId === 'rogue_asteroid' && round.flight) {
          armAsteroidHazard(round.flight, item.id);
        }
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
    if (em.typeId === 'oxygen_leak' && isBuffActive(round, 'stabilize', now)) continue;
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
  if (elapsed >= round.duration) {
    if (!isMissionComplete(round)) {
      round.causeOfDeath = 'mission_objective_incomplete';
      return _endRound(room, now, 'lose');
    }
    return _endRound(room, now, 'win');
  }

  return room;
}

function createMissionState(duration) {
  const fullMission = duration >= ROUND_DURATION_MS;
  return {
    requiredEmergencyResolutions: fullMission ? COOPERATIVE_EMERGENCY_TARGET : 0,
    requiredCrewMembers: fullMission ? COOPERATIVE_CREW_TARGET : 0,
    crewMemberIds: []
  };
}

function recordMissionContribution(round, playerId) {
  const wasComplete = getMissionProgress(round).complete;
  if (!round.mission || !Array.isArray(round.mission.crewMemberIds)) {
    round.mission = round.mission || createMissionState(round.duration || ROUND_DURATION_MS);
    round.mission.crewMemberIds = Array.isArray(round.mission.crewMemberIds) ? round.mission.crewMemberIds : [];
  }
  if (!round.mission.crewMemberIds.includes(playerId)) round.mission.crewMemberIds.push(playerId);
  const progress = getMissionProgress(round);
  if (!wasComplete && progress.complete) {
    recordCrewEvent(round, {
      type: 'mission',
      nickname: 'Crew',
      message: 'Shared response objectives secured. Protect the hull until mission end.',
      timestamp: Date.now()
    });
  }
  return progress;
}

function recordCrewEvent(round, event) {
  round.crewEvents = Array.isArray(round.crewEvents) ? round.crewEvents : [];
  const stableId = typeof event.id === 'string' && event.id ? event.id : null;
  if (stableId) {
    const existing = round.crewEvents.find(entry => entry.id === stableId);
    if (existing) return existing;
  }
  round.crewEventSequence = (round.crewEventSequence || 0) + 1;
  const entry = {
    id: stableId || `crew_${round.crewEventSequence}`,
    type: String(event.type || 'action').slice(0, 32),
    nickname: String(event.nickname || 'Crew').slice(0, 20),
    message: String(event.message || '').slice(0, 180),
    timestamp: Number.isFinite(event.timestamp) ? event.timestamp : Date.now()
  };
  round.crewEvents.push(entry);
  round.crewEvents = round.crewEvents.slice(-8);
  return entry;
}

function getMissionProgress(round) {
  const mission = round?.mission || {};
  const requiredEmergencyResolutions = Math.max(0, mission.requiredEmergencyResolutions || 0);
  const requiredCrewMembers = Math.max(0, mission.requiredCrewMembers || 0);
  const emergenciesResolved = Math.max(0, round?.emergenciesResolved || 0);
  const crewMembersContributed = new Set(mission.crewMemberIds || []).size;
  return {
    requiredEmergencyResolutions,
    emergenciesResolved,
    requiredCrewMembers,
    crewMembersContributed,
    complete: emergenciesResolved >= requiredEmergencyResolutions && crewMembersContributed >= requiredCrewMembers
  };
}

function isMissionComplete(round) {
  return getMissionProgress(round).complete;
}

function _endRound(room, now, outcome) {
  const round = room.round;
  const roundDurationSeconds = Math.ceil((round.duration || ROUND_DURATION_MS) / 1000);
  const survivedSeconds = Math.min(roundDurationSeconds, Math.floor((now - round.startedAt) / 1000));
  const remainingSeconds = outcome === 'win' ? Math.max(0, roundDurationSeconds - survivedSeconds) : 0;
  const scoreBreakdown = {
    missionComplete: outcome === 'win' ? 1000 : 0,
    remainingTime: remainingSeconds * 10,
    hullIntegrity: Math.floor(round.hullIntegrity) * 5,
    emergenciesResolved: (round.emergenciesResolved || 0) * 75,
    rapidResponses: (round.speedBonuses || 0) * 25,
    combatScore: round.score || 0,
    communicationsScore: round.communicationScore || 0
  };
  const finalScore = Object.values(scoreBreakdown).reduce((sum, points) => sum + points, 0);

  room.phase = 'results';
  round.outcome          = outcome;
  round.survivedSeconds  = survivedSeconds;
  round.finalScore       = Math.floor(finalScore);
  round.roundDurationSeconds = roundDurationSeconds;
  round.scoreBreakdown = scoreBreakdown;
  round.endedAt          = now;
  return room;
}

// ── ID Generation ─────────────────────────────────────────────────────────────
function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[randomInt(ROOM_CODE_CHARS.length)];
  }
  return code;
}

function generatePlayerId() {
  return 'p_' + randomBytes(24).toString('base64url');
}

// ── Module Exports ────────────────────────────────────────────────────────────
module.exports = {
  ROUND_DURATION_MS,
  COOPERATIVE_EMERGENCY_TARGET,
  COOPERATIVE_CREW_TARGET,
  createMissionState,
  getMissionProgress,
  recordMissionContribution,
  recordCrewEvent,
  isMissionComplete,
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
  createFlightState,
  assignRoles,
  canRoleResolve,
  tickGameState,
  isBuffActive,
  addBuff,
  pruneBuffs
};
