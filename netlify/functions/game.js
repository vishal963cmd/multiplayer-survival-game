'use strict';

// ════════════════════════════════════════════════════════════════════════════
// Signal Shift: Survive Together — Netlify Function
// Route: /.netlify/functions/game
// All game actions handled via a single function with an `action` discriminator.
// State lives exclusively in Netlify Blobs with optimistic ETag locking.
// ════════════════════════════════════════════════════════════════════════════

// getStore will be required lazily inside store()

const {
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  INITIAL_HULL,
  ROUND_DURATION_MS,
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
  addBuff
} = require('../../shared/gameRules');

const STORE_NAME  = 'signal-shift-rooms';
const MAX_RETRIES = 4;

// ── Helpers ──────────────────────────────────────────────────────────────────

function store() {
  // In Netlify Functions (production) the environment variable AWS_LAMBDA_FUNCTION_NAME is set.
  // The runtime file system is read‑only, so we must NOT attempt to write a JSON file.
  const isProd = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

  if (isProd) {
    // Require Netlify Blobs – let any error surface (misconfiguration) instead of silencing.
    const { getStore } = require('@netlify/blobs');
    return getStore({ name: STORE_NAME, consistency: 'strong' });
  }


  }

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function ok(body)          { return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) }; }
function fail(code, msg)   { return { statusCode: code, headers: corsHeaders(), body: JSON.stringify({ error: msg }) }; }

async function readRoom(s, key) {
  const res = await s.getWithMetadata(key, { type: 'json' });
  if (!res) return { room: null, etag: null };
  return { room: res.data, etag: res.etag };
}

async function writeRoom(s, key, data, etag) {
  const onlyIf = etag !== null ? { etag } : { exists: false };
  try {
    await s.setJSON(key, data, { onlyIf });
    return true;
  } catch (e) {
    const msg    = String(e?.message || '');
    const status = e?.status || e?.statusCode || 0;
    if (
      status === 412 ||
      msg.includes('412') ||
      msg.toLowerCase().includes('precondition') ||
      msg.toLowerCase().includes('etag') ||
      msg.toLowerCase().includes('conflict') ||
      msg.toLowerCase().includes('not match')
    ) {
      return false; // optimistic lock conflict — caller should retry
    }
    throw e;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// withRetry: passes 'RETRY' string back to signal a retry is needed
async function withRetry(fn) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await fn();
    if (result !== 'RETRY') return result;
    if (attempt < MAX_RETRIES - 1) await sleep(40 + attempt * 60);
  }
  return fail(409, 'Concurrent modification conflict — please try again.');
}

// ── Main Handler ──────────────────────────────────────────────────────────────

module.exports._store = store;
exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  let s;
  try {
    s = store();
  } catch (e) {
    console.error('[signal-shift] Store init error:', e);
    return fail(500, e.message);
  }
  let action, body;

  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    action  = q.action || 'get_state';
    body    = q;
  } else {
    try   { body = JSON.parse(event.body || '{}'); }
    catch { return fail(400, 'Invalid JSON body'); }
    action = body.action;
  }

  try {
    switch (action) {
      case 'create_room':     return await handleCreateRoom(s, body);
      case 'join_room':       return await handleJoinRoom(s, body);
      case 'get_state':       return await handleGetState(s, body);
      case 'start_game':      return await handleStartGame(s, body);
      case 'player_action':   return await handlePlayerAction(s, body);
      case 'request_rematch': return await handleRematch(s, body);
      case 'ping':            return await handlePing(s, body);
      default:                return fail(400, `Unknown action: ${action}`);
    }
  } catch (e) {
    console.error('[signal-shift] Unhandled error:', e);
    return fail(500, 'Internal server error');
  }
};

// ════════════════════════════════════════════════════════════════════════════
// Action Handlers
// ════════════════════════════════════════════════════════════════════════════

async function handleCreateRoom(s, body) {
  const nickname = (body.nickname || '').trim().slice(0, 20);
  if (!nickname) return fail(400, 'Nickname is required');

  for (let attempt = 0; attempt < 5; attempt++) {
    const roomCode = generateRoomCode();
    const { room: existing } = await readRoom(s, roomCode);
    if (existing) continue; // collision — try again

    const playerId = generatePlayerId();
    const roomData = {
      roomCode,
      hostId: playerId,
      phase: 'lobby',
      createdAt: Date.now(),
      players: [{
        id: playerId,
        nickname,
        role: null,
        connected: true,
        lastSeen: Date.now()
      }],
      round: null,
      rematchVotes: {}
    };

    const written = await writeRoom(s, roomCode, roomData, null);
    if (!written) continue; // race on the same code — try new code

    return ok({ roomCode, playerId, room: sanitize(roomData, playerId) });
  }

  return fail(500, 'Could not generate a unique room code. Please try again.');
}

async function handleJoinRoom(s, body) {
  const roomCode = (body.roomCode || '').toUpperCase().trim();
  const nickname = (body.nickname || '').trim().slice(0, 20);

  if (!roomCode)  return fail(400, 'Room code is required');
  if (!nickname)  return fail(400, 'Nickname is required');

  return withRetry(async () => {
    const { room, etag } = await readRoom(s, roomCode);
    if (!room) return fail(404, 'Room not found — check the code and try again.');

    if (room.phase !== 'lobby') return fail(400, 'This game has already started.');
    if (room.players.length >= MAX_PLAYERS) return fail(400, 'Room is full (6 players max).');

    const taken = room.players.some(p => p.nickname.toLowerCase() === nickname.toLowerCase());
    if (taken) return fail(400, 'That nickname is already taken in this room.');

    const playerId = generatePlayerId();
    room.players.push({
      id: playerId,
      nickname,
      role: null,
      connected: true,
      lastSeen: Date.now()
    });

    const written = await writeRoom(s, roomCode, room, etag);
    if (!written) return 'RETRY';

    return ok({ roomCode, playerId, room: sanitize(room, playerId) });
  });
}

async function handleGetState(s, body) {
  const roomCode = (body.roomCode || '').toUpperCase().trim();
  const playerId = body.playerId || '';

  if (!roomCode) return fail(400, 'Room code is required');

  return withRetry(async () => {
    const { room, etag } = await readRoom(s, roomCode);
    if (!room) return fail(404, 'Room not found');

    const now = Date.now();

    // Update lastSeen for the polling player
    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.lastSeen = now;
      player.connected = true;
    }

    // Refresh connection status for all players
    room.players.forEach(p => {
      p.connected = (now - (p.lastSeen || 0)) < DISCONNECT_TIMEOUT_MS;
    });

    // Tick game state (spawns emergencies, applies damage, checks win/lose)
    if (room.phase === 'playing') {
      tickGameState(room, now);
      // Ensure updatedAt always moves forward (monotonic)
      if (room.round) {
        const last = room.round.updatedAt || 0;
        room.round.updatedAt = Math.max(last + 1, now + 1);
      }
    }
    const written = await writeRoom(s, roomCode, room, etag);
    if (!written) return 'RETRY';

    return ok({ room: sanitize(room, playerId) });
  });
}

async function handleStartGame(s, body) {
  const roomCode = (body.roomCode || '').toUpperCase().trim();
  const playerId = body.playerId || '';

  return withRetry(async () => {
    const { room, etag } = await readRoom(s, roomCode);
    if (!room) return fail(404, 'Room not found');
    if (room.hostId !== playerId) return fail(403, 'Only the host can start the game');
    if (room.phase !== 'lobby') return fail(400, 'Game already started');

    // Use total player count (including possibly not yet marked connected) to allow starting.
    const totalPlayers = room.players.length;
    if (totalPlayers < MIN_PLAYERS_TO_START) {
      return fail(400, `Need at least ${MIN_PLAYERS_TO_START} players to start`);
    }

    const now = Date.now();
    const connected = room.players.filter(p => p.connected);
    const playersWithRoles = assignRoles(connected);
    const roleIds = playersWithRoles.map(p => p.role);
    const schedule = generateEmergencySchedule(now, connected.length, roleIds);
    // Deterministic emergency for integration tests when testMode flag is set
    // Deterministic emergency for integration tests – only active in non‑production environments.
    if (body.testMode && process.env.NODE_ENV !== 'production') {
      schedule.unshift({
        id: `em_test_nav_${now}`,
        spawnAt: now + 2000,
        typeId: 'nav_failure',
        severity: 1
      });
    }
    // Deterministic nav_failure emergency for integration tests
    if (process.env.NODE_ENV === 'test') {
      schedule.unshift({
        id: `em_test_nav_${now}`,
        spawnAt: now + 2000,
        typeId: 'nav_failure',
        severity: 1
      });
    }

    room.players = room.players.map(p => {
      const assigned = playersWithRoles.find(pr => pr.id === p.id);
      return assigned ? { ...p, role: assigned.role } : { ...p, role: null };
    });

    room.phase = 'playing';
    // Use shortened duration for test mode so integration tests finish quickly
    const roundDuration = (body.testMode && process.env.NODE_ENV !== 'production') ? 30000 : ROUND_DURATION_MS;
    room.round = {
      startedAt: now,
      updatedAt: now,
      // expose round updatedAt for easier client checks
      duration: roundDuration,
      hullIntegrity: INITIAL_HULL,
      score: 0,
      emergenciesResolved: 0,
      speedBonuses: 0,
      schedule,
      activeEmergencies: [],
      resolvedEmergencies: [],
      repairCooldowns: {},
      activeBuffs: [],
      lastTickAt: now,
      causeOfDeath: null,
      outcome: null,
      survivedSeconds: null,
      finalScore: null,
      lastAction: null,
      broadcastAlert: null
    };
    room.rematchVotes = {};

    const written = await writeRoom(s, roomCode, room, etag);
    if (!written) return 'RETRY';

    return ok({ room: sanitize(room, playerId) });
  });
}

async function handlePlayerAction(s, body) {
  const roomCode          = (body.roomCode || '').toUpperCase().trim();
  const playerId          = body.playerId || '';
  const abilityId         = body.abilityId || '';
  const targetEmergencyId = body.targetEmergencyId || null;
  const targetSystem      = body.targetSystem || null;

  if (!abilityId) return fail(400, 'abilityId is required');

  return withRetry(async () => {
    const { room, etag } = await readRoom(s, roomCode);
    if (!room) return fail(404, 'Room not found');
    if (room.phase !== 'playing') return fail(400, 'Game is not in progress');

    const player = room.players.find(p => p.id === playerId);
    if (!player) return fail(404, 'You are not in this room');
    if (!player.role) return fail(400, 'Role not yet assigned');

    const roleDef   = ROLES.find(r => r.id === player.role);
    const abilityDef = roleDef?.abilities.find(a => a.id === abilityId);
    const now   = Date.now();
    const round = room.round;
    // ── Special: crew_respond — available to ALL players for radiation_burst ──────
    if (abilityId === 'crew_respond') {
      const crKey   = `${playerId}__crew_respond`;
      const crUntil = round.repairCooldowns[crKey] || 0;
      if (now < crUntil) {
        return fail(400, `Crew response on cooldown for ${Math.ceil((crUntil - now) / 1000)} more seconds`);
      }
      const crEm = targetEmergencyId
        ? round.activeEmergencies.find(e => e.id === targetEmergencyId && !e.resolvedAt)
        : round.activeEmergencies.find(e => !e.resolvedAt && e.typeId === 'radiation_burst');
      if (!crEm) return fail(400, 'No all-hands emergency to respond to right now.');

      // Inline resolve
      crEm.resolvedAt           = now;
      crEm.resolvedBy           = playerId;
      crEm.resolvedByNickname   = player.nickname;
      round.emergenciesResolved = (round.emergenciesResolved || 0) + 1;
      if (now - crEm.spawnedAt <= 5000) round.speedBonuses = (round.speedBonuses || 0) + 1;

      round.repairCooldowns[crKey] = now + 15000;
      round.lastAction = { playerId, nickname: player.nickname, abilityId: 'crew_respond', abilityName: 'Crew Response', timestamp: now };

      tickGameState(room, now);
      // Ensure updatedAt monotonic increase for crew_respond path
      if (room.round) {
        const last = room.round.updatedAt || 0;
        room.round.updatedAt = Math.max(last + 1, now + 1);
      }
      const crWritten = await writeRoom(s, roomCode, room, etag);
      if (!crWritten) return 'RETRY';
      return ok({ success: true, room: sanitize(room, playerId) });
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (!abilityDef) return fail(403, `Ability "${abilityId}" is not available for your role`);

    // ── Cooldown check ────────────────────────────────────────────
    const cdKey    = `${playerId}__${abilityId}`;
    const cdUntil  = round.repairCooldowns[cdKey] || 0;
    const allHands = isBuffActive(round, 'all_hands');

    if (now < cdUntil) {
      return fail(400, `Ability on cooldown for ${Math.ceil((cdUntil - now) / 1000)} more seconds`);
    }

    // ── Apply the ability ─────────────────────────────────────────
    const result = applyAbility({ abilityId, player, round, now, targetEmergencyId, targetSystem });
    if (result.error) return fail(400, result.error);

    // ── Set cooldown ──────────────────────────────────────────────
    let cd = abilityDef.cooldownMs;
    if (allHands) cd = Math.floor(cd / 2);
    round.repairCooldowns[cdKey] = now + cd;

    // ── Broadcast last action ─────────────────────────────────────
    round.lastAction = {
      playerId,
      nickname:    player.nickname,
      abilityId,
      abilityName: abilityDef.name,
      timestamp:   now
    };

    // ── Tick state ────────────────────────────────────────────────
    tickGameState(room, now);
    // Ensure updatedAt always moves forward (monotonic)
    if (room.round) {
      const last = room.round.updatedAt || 0;
      room.round.updatedAt = Math.max(last + 1, now + 1);
    }

    const written = await writeRoom(s, roomCode, room, etag);
    if (!written) return 'RETRY';

    return ok({
      success: true,
      room: sanitize(room, playerId),
      cooldownUntil: round.repairCooldowns[cdKey]
    });
  });
}

// ── Ability Implementations ───────────────────────────────────────────────────

function applyAbility({ abilityId, player, round, now, targetEmergencyId, targetSystem }) {

  function findEM(typeFilter) {
    let pool = round.activeEmergencies.filter(e => !e.resolvedAt);
    if (typeFilter) pool = pool.filter(e => typeFilter.includes(e.typeId));
    if (targetEmergencyId) pool = pool.filter(e => e.id === targetEmergencyId);
    return pool[0] || null;
  }

  function resolveEM(em) {
    em.resolvedAt          = now;
    em.resolvedBy          = player.id;
    em.resolvedByNickname  = player.nickname;
    round.emergenciesResolved = (round.emergenciesResolved || 0) + 1;
    if (now - em.spawnedAt <= 5000) {
      round.speedBonuses = (round.speedBonuses || 0) + 1;
    }
  }


    switch (abilityId) {
case 'patch_hull': {
      round.hullIntegrity = Math.min(100, round.hullIntegrity + 15);
      // Engineer universal fallback: also mark a targeted emergency resolved
      if (targetEmergencyId) {
        const em = round.activeEmergencies.find(e => e.id === targetEmergencyId && !e.resolvedAt);
        if (em) resolveEM(em);
      } else {
        // Auto-resolve the most pressing resolvable emergency if no explicit target
        const em = round.activeEmergencies.find(e => !e.resolvedAt &&
          ['engine_fire', 'hull_breach'].includes(e.typeId));
        if (em) resolveEM(em);
      }
      return { success: true };
    }

    case 'boost_shields': {
      addBuff(round, 'boost_shields', 10000);
      return { success: true };
    }

    case 'evade': {
      const em = findEM(['rogue_asteroid', 'nav_failure']);
      if (!em) return { error: 'No asteroid or navigation emergency to evade right now.' };
      resolveEM(em);
      return { success: true };
    }

    case 'chart_course': {
      addBuff(round, 'chart_course', 15000);
      return { success: true };
    }

    case 'reroute_power': {
      const em = findEM(['power_surge']);
      if (em) {
        resolveEM(em);
      } else {
        // No active power surge — boost a system instead
        const sys = targetSystem || 'engines';
        if (round.systemStates && round.systemStates[sys] !== undefined) {
          round.systemStates[sys] = Math.min(100, (round.systemStates[sys] || 0) + 40);
        }
      }
      return { success: true };
    }

    case 'emergency_broadcast': {
      const knownIds = new Set([
        ...round.activeEmergencies.map(e => e.id),
        ...(round.resolvedEmergencies || []).map(e => e.id)
      ]);
      const next = round.schedule.find(item => item.spawnAt > now && !knownIds.has(item.id));
      if (next) {
        next.spawnAt = now + 8000; // pull forward
        const def = EMERGENCY_TYPES.find(e => e.id === next.typeId);
        round.broadcastAlert = {
          typeId:     next.typeId,
          name:       def?.name || next.typeId,
          icon:       def?.icon || '⚠️',
          revealedAt: now
        };
      }
      return { success: true };
    }

    case 'stabilize': {
      addBuff(round, 'stabilize', 20000);
      // Also resolve an active oxygen_leak
      const oxEm = targetEmergencyId
        ? round.activeEmergencies.find(e => e.id === targetEmergencyId && e.typeId === 'oxygen_leak' && !e.resolvedAt)
        : findEM(['oxygen_leak']);
      if (oxEm) resolveEM(oxEm);
      return { success: true };
    }

    case 'triage': {
      // Reduce all active cooldowns by 4 s
      for (const key of Object.keys(round.repairCooldowns)) {
        round.repairCooldowns[key] = Math.max(now, round.repairCooldowns[key] - 4000);
      }
      return { success: true };
    }

    case 'counter_blast': {
      const em = findEM(['rogue_asteroid', 'radiation_burst']);
      if (!em) return { error: 'No asteroid or radiation threat to blast right now.' };
      resolveEM(em);
      round.score = (round.score || 0) + 50;
      return { success: true };
    }

    case 'point_defense': {
      addBuff(round, 'point_defense', ROUND_DURATION_MS);
      return { success: true };
    }

    case 'all_hands': {
      addBuff(round, 'all_hands', 10000);
      return { success: true };
    }

    case 'priority_override': {
      const em = round.activeEmergencies.find(e => !e.resolvedAt);
      if (!em) return { error: 'No active emergency to override.' };
      resolveEM(em);
      return { success: true };
    }

    default:
      return { error: `Unknown ability: ${abilityId}` };
  }
}

async function handleRematch(s, body) {
  const roomCode = (body.roomCode || '').toUpperCase().trim();
  const playerId = body.playerId || '';

  return withRetry(async () => {
    const { room, etag } = await readRoom(s, roomCode);
    if (!room) return fail(404, 'Room not found');
    if (room.phase !== 'results') return fail(400, 'Game not finished yet');
    if (room.hostId !== playerId) return fail(403, 'Only the host can start a rematch');

    // Use total player count for rematch eligibility, allowing players who may have been marked disconnected after game end
    if (room.players.length < MIN_PLAYERS_TO_START) {
      return fail(400, 'Need at least 2 players for a rematch');
    }

    const now = Date.now();
    const connected = room.players.filter(p => p.connected);
    const playersWithRoles = assignRoles(connected);
    const roleIds = playersWithRoles.map(p => p.role);
    const schedule = generateEmergencySchedule(now, connected.length, roleIds);

    room.players = room.players.map(p => {
      const assigned = playersWithRoles.find(pr => pr.id === p.id);
      return assigned ? { ...p, role: assigned.role } : { ...p, role: null };
    });

    // Initialize game round with updatedAt and test-mode duration
    room.phase = 'playing';
    room.round = {
      startedAt: now,
      // Use shortened duration for tests to ensure timely results
      duration: (process.env.NODE_ENV === 'test' || body.testMode) ? 30000 : ROUND_DURATION_MS,
      hullIntegrity: INITIAL_HULL,
      score: 0,
      emergenciesResolved: 0,
      speedBonuses: 0,
      schedule,
      activeEmergencies: [],
      resolvedEmergencies: [],
      repairCooldowns: {},
      activeBuffs: [],
      lastTickAt: now,
      causeOfDeath: null,
      outcome: null,
      survivedSeconds: null,
      finalScore: null,
      lastAction: null,
      broadcastAlert: null,
      updatedAt: now // monotonic timestamp for round state
    };
    room.rematchVotes = {};

    const written = await writeRoom(s, roomCode, room, etag);
    if (!written) return 'RETRY';

    return ok({ room: sanitize(room, playerId) });
  });
}

async function handlePing(s, body) {
  const roomCode = (body.roomCode || '').toUpperCase().trim();
  const playerId = body.playerId || '';
  if (!roomCode || !playerId) return ok({ ok: true });

  return withRetry(async () => {
    const { room, etag } = await readRoom(s, roomCode);
    if (!room) return ok({ ok: true });

    const player = room.players.find(p => p.id === playerId);
    if (player) { player.lastSeen = Date.now(); player.connected = true; }

    const written = await writeRoom(s, roomCode, room, etag);
    if (!written) return 'RETRY';
    return ok({ ok: true });
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Sanitize Room for Client
// Strips server-only fields, adds computed fields, scopes cooldowns to requester
// ════════════════════════════════════════════════════════════════════════════

function sanitize(room, myPlayerId) {
  const now = Date.now();

  const out = {
    roomCode: room.roomCode,
    hostId:   room.hostId,
    phase:    room.phase,
    isHost:   room.hostId === myPlayerId,
    // expose round updatedAt for comparisons
    updatedAt: room.round ? room.round.updatedAt : undefined,
    players:  room.players.map(p => ({
      id:        p.id,
      nickname:  p.nickname,
      role:      p.role,
      connected: p.connected,
      isHost:    p.id === room.hostId,
      isMe:      p.id === myPlayerId
    }))
  };

  if (room.phase === 'playing' && room.round) {
    const r       = room.round;
    const elapsed = now - r.startedAt;
    const remaining = Math.max(0, r.duration - elapsed);

    // Compute cooldowns scoped to the requesting player
    const myCooldowns = (() => {
      const me = room.players.find(p => p.id === myPlayerId);
      if (!me?.role) return {};
      const roleDef = ROLES.find(rl => rl.id === me.role);
      if (!roleDef) return {};
      const cds = {};
      for (const a of roleDef.abilities) {
        const until = r.repairCooldowns[`${myPlayerId}__${a.id}`] || 0;
        cds[a.id] = Math.max(0, until - now);
      }
      // crew_respond is usable by any player for radiation_burst
      cds['crew_respond'] = Math.max(0, (r.repairCooldowns[`${myPlayerId}__crew_respond`] || 0) - now);
      return cds;
    })();

    out.round = {
      remainingMs:         remaining,
      elapsedMs:           elapsed,
      hullIntegrity:       Math.max(0, Math.round(r.hullIntegrity * 10) / 10),
      score:               r.score || 0,
      emergenciesResolved: r.emergenciesResolved || 0,
      lastAction:          r.lastAction,
      broadcastAlert:      r.broadcastAlert,
      updatedAt:           r.updatedAt,
      activeBuffs: (r.activeBuffs || [])
        .filter(b => b.expiresAt > now)
        .map(b => ({ id: b.id, remainingMs: b.expiresAt - now })),
      activeEmergencies: r.activeEmergencies.map(em => {
        const def = EMERGENCY_TYPES.find(e => e.id === em.typeId);
        return {
          id:                  em.id,
          typeId:              em.typeId,
          name:                def?.name       || em.typeId,
          icon:                def?.icon       || '⚠️',
          description:         def?.description|| '',
          severity:            em.severity,
          spawnedAt:           em.spawnedAt,
          expiresAt:           em.expiresAt,
          resolvedAt:          em.resolvedAt,
          resolvedByNickname:  em.resolvedByNickname,
          timeLeftMs:          em.resolvedAt ? 0 : Math.max(0, em.expiresAt - now),
          resolveRole:         def?.resolveRole || null,
          altRole:             def?.altRole    || null,
          anyCanResolve:       !def?.resolveRole
        };
      }),
      myCooldowns
    };
  }

  if (room.phase === 'results' && room.round) {
    const r = room.round;
    out.results = {
      outcome:             r.outcome,
      finalScore:          r.finalScore || 0,
      survivedSeconds:     r.survivedSeconds || 0,
      emergenciesResolved: r.emergenciesResolved || 0,
      hullIntegrity:       Math.round((r.hullIntegrity || 0) * 10) / 10,
      causeOfDeath:        r.causeOfDeath || null
    };
  }

  return out;
}
