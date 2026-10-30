'use strict';

const { randomUUID, randomInt } = require('node:crypto');

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
  createMissionState,
  getMissionProgress,
  recordMissionContribution,
  recordCrewEvent,
  tickGameState,
  createFlightState,
  isBuffActive,
  addBuff
} = require('../../shared/gameRules');
const {
  LOBBY_IDLE_TTL_MS,
  RESULTS_RETENTION_MS,
  isSessionExpired,
  isRoomExpired,
  touchRoom,
  setResultsExpiry,
  closeRoom,
  setActiveMatchExpiry,
  promoteHostIfDisconnected
} = require('../../shared/roomLifecycle');
const { setFlightInput, divertAsteroidHazard, getThreatRadar, launchPulseCannonProjectile } = require('../../shared/spaceflight');

const STORE_NAME = 'signal-shift-rooms';
const MAX_RETRIES = 4;
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_CHAT_MESSAGES = 100;
const MAX_CHAT_LENGTH = 500;
const CHAT_WINDOW_MS = 10_000;
const CHAT_WINDOW_LIMIT = 5;
const localMutationQueues = new Map();
const localMutationLocks = new Set();
let testStoreProvider = null;

function ensureContributions(round) {
  round.contributions = round.contributions || {};
  for (const key of ['pilotManeuvers', 'navigatorMarks', 'navigatorDiversions', 'engineerRepairs', 'engineerHullRestored', 'engineerShieldActivations', 'gunnerShots', 'gunnerAsteroidsDestroyed', 'powerAllocations', 'powerBoosts', 'communicationsTasks']) {
    if (!Number.isFinite(round.contributions[key])) round.contributions[key] = 0;
  }
  return round.contributions;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function store(event = {}) {
  const { connectLambda, getStore, setEnvironmentContext } = require('@netlify/blobs');
  const rawContext = globalThis.netlifyBlobsContext || process.env.NETLIFY_BLOBS_CONTEXT;
  let context = {};

  if (typeof rawContext === 'string' && rawContext) {
    try { context = JSON.parse(Buffer.from(rawContext, 'base64').toString('utf8')); } catch { }
  } else if (rawContext && typeof rawContext === 'object') {
    context = rawContext;
  }

  // Netlify Dev provides the local sandbox context with both cached and
  // uncached URLs. Do not let connectLambda(event) replace it with edge-only
  // configuration, which cannot satisfy strong reads.
  if (!context.uncachedEdgeURL && event.blobs) {
    const blobConfig = JSON.parse(Buffer.from(event.blobs, 'base64').toString('utf8'));
    if (blobConfig.url_uncached) {
      setEnvironmentContext({
        deployID: event.headers?.['x-nf-deploy-id'],
        edgeURL: blobConfig.url,
        uncachedEdgeURL: blobConfig.url_uncached,
        siteID: event.headers?.['x-nf-site-id'] || process.env.NETLIFY_SITE_ID,
        token: blobConfig.token,
        primaryRegion: blobConfig.primary_region
      });
      context = { ...context, edgeURL: blobConfig.url, uncachedEdgeURL: blobConfig.url_uncached };
    }
  }

  const hasApiCredentials = Boolean(process.env.NETLIFY_SITE_ID && process.env.NETLIFY_AUTH_TOKEN);
  const hasStrongRuntimeContext = Boolean(context.uncachedEdgeURL);
  const hasApiRuntimeContext = Boolean(context.siteID && context.token && !context.edgeURL);
  if (!hasStrongRuntimeContext && !hasApiRuntimeContext && !hasApiCredentials &&
    typeof connectLambda === 'function' && Object.keys(event).length > 0) {
    connectLambda(event);
  }

  const opts = { name: STORE_NAME, consistency: 'strong' };

  // Explicit credentials select the strongly-consistent API path only when
  // the runtime has not already supplied a complete local or API context.
  if (!hasStrongRuntimeContext && !hasApiRuntimeContext && process.env.NETLIFY_SITE_ID) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
  }

  if (!hasStrongRuntimeContext && !hasApiRuntimeContext && process.env.NETLIFY_AUTH_TOKEN) {
    opts.token = process.env.NETLIFY_AUTH_TOKEN;
  }

  return getStore(opts);
}

function createSignalTask(now) {
  const symbols = ['▲', '●', '■', '◆'];
  const sequence = Array.from({ length: 3 }, () => symbols[randomInt(symbols.length)]);
  const options = [sequence];
  while (options.length < 4) {
    const candidate = Array.from({ length: 3 }, () => symbols[randomInt(symbols.length)]);
    if (!options.some(option => option.join('') === candidate.join(''))) options.push(candidate);
  }
  for (let i = options.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [options[i], options[j]] = [options[j], options[i]];
  }
  return {
    id: randomUUID(), sequence, options,
    answerIndex: String(options.findIndex(option => option.join('') === sequence.join(''))),
    expiresAt: now + 30000, completedAt: null, expiredAt: null, attemptsRemaining: 3
  };
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

function normalizeRoomCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-HJ-NP-Z]{6}$/.test(code) ? code : null;
}

function normalizePlayerId(value) {
  return typeof value === 'string' && /^p_[A-Za-z0-9_-]{8,80}$/.test(value) ? value : null;
}

function normalizeNickname(value) {
  if (typeof value !== 'string') return null;
  const nickname = value.normalize('NFC').trim();
  if (!nickname || nickname.length > 20 || /[\u0000-\u001F\u007F-\u009F]/.test(nickname)) return null;
  return nickname;
}

function isTestMode(body) {
  return process.env.ENABLE_TEST_MODE === 'true' && (body.testMode === true || process.env.NETLIFY_DEV === 'true');
}

function getRoundDuration(body) {
  if (!isTestMode(body)) return ROUND_DURATION_MS;
  const requested = Number(process.env.TEST_ROUND_DURATION_MS);
  return Number.isFinite(requested) ? Math.max(1000, Math.min(requested, 30000)) : 30000;
}

function ok(body) { return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) }; }
function fail(code, msg) { return { statusCode: code, headers: corsHeaders(), body: JSON.stringify({ error: msg }) }; }

async function readRoom(s, key) {
  const res = await s.getWithMetadata(key, { type: 'json' });
  if (!res) return { room: null, etag: null };
  return { room: res.data, etag: res.etag };
}

async function writeRoom(s, key, data, etag) {
  let opts;
  if (etag === null) {
    opts = { onlyIfNew: true };
  } else if (typeof etag === 'string' && etag.length > 0) {
    opts = { onlyIfMatch: etag };
  } else if (process.env.NETLIFY_DEV === 'true' && localMutationLocks.has(key)) {
    // Netlify Dev's sandbox store omits ETags. The local-only room queue keeps
    // the read/update/write sequence exclusive while retaining Blobs storage.
    opts = {};
  } else {
    throw new Error('Cannot safely update room without a storage ETag');
  }

  try {
    const res = await s.setJSON(key, data, opts);
    // setJSON resolves { modified, etag }. When a conflict occurs, modified is false.
    return res.modified === true;
  } catch (e) {
    const msg = String(e?.message || '');
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

async function withRoomMutation(roomCode, fn) {
  if (process.env.NETLIFY_DEV !== 'true') return fn();

  const previous = localMutationQueues.get(roomCode) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  const tail = previous.then(() => current);
  localMutationQueues.set(roomCode, tail);
  await previous;
  localMutationLocks.add(roomCode);

  try {
    return await fn();
  } finally {
    localMutationLocks.delete(roomCode);
    release();
    if (localMutationQueues.get(roomCode) === tail) localMutationQueues.delete(roomCode);
  }
}

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
exports.config = {
  path: '/.netlify/functions/game',
  rateLimit: {
    windowLimit: 300,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (!['GET', 'POST'].includes(event.httpMethod)) return fail(405, 'Method not allowed');

  let action, body;

  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    action = q.action || 'get_state';
    body = q;
  } else {
    const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';
    if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
      return fail(415, 'Content-Type must be application/json');
    }
    const requestBody = event.body || '';
    if (Buffer.byteLength(requestBody, 'utf8') > MAX_REQUEST_BYTES) return fail(413, 'Request body is too large');
    try { body = JSON.parse(requestBody || '{}'); }
    catch { return fail(400, 'Invalid JSON body'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'JSON body must be an object');
    action = body.action;
  }

  if (typeof action !== 'string' || action.length === 0) return fail(400, 'Action is required');
  if (event.httpMethod === 'GET' && action !== 'get_state') return fail(405, 'Only get_state is available with GET');

  let s;
  try {
    s = testStoreProvider ? testStoreProvider(event) : store(event);
  } catch (e) {
    console.error('[signal-shift] Store init failure:', { name: e?.name, code: e?.code });
    return fail(500, 'Game storage is unavailable');
  }

  try {
    switch (action) {
      case 'create_room': return await handleCreateRoom(s, body);
      case 'join_room': return await handleJoinRoom(s, body);
      case 'get_state': return await handleGetState(s, body);
      case 'send_chat': return await handleSendChat(s, body);
      case 'set_course': return await handleSetCourse(s, body);
      case 'mark_threat': return await handleMarkThreat(s, body);
      case 'start_game': return await handleStartGame(s, body);
      case 'player_action': return await handlePlayerAction(s, body);
      case 'request_rematch': return await handleRematch(s, body);
      case 'ping': return await handlePing(s, body);
      case 'leave_room': return await handleLeaveRoom(s, body);
      default: return fail(400, `Unknown action: ${action}`);
    }
  } catch (e) {
    console.error('[signal-shift] Request failure:', { name: e?.name, code: e?.code, status: e?.status || e?.statusCode });
    return fail(500, 'Internal server error');
  }
};

// ════════════════════════════════════════════════════════════════════════════
// Action Handlers
// ════════════════════════════════════════════════════════════════════════════

async function handleCreateRoom(s, body) {
  const nickname = normalizeNickname(body.nickname);
  if (!nickname) return fail(400, 'Nickname must be 1–20 characters without control characters');

  for (let attempt = 0; attempt < 5; attempt++) {
    const roomCode = generateRoomCode();
    const { room: existing } = await readRoom(s, roomCode);
    if (existing && !(existing.phase === 'closed' && isRoomExpired(existing, Date.now()))) continue;

    const playerId = generatePlayerId();
    const now = Date.now();
    const roomData = {
      roomCode,
      hostId: playerId,
      phase: 'lobby',
      createdAt: now,
      lastActivityAt: now,
      expiresAt: now + LOBBY_IDLE_TTL_MS,
      matchId: null,
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
  const roomCode = normalizeRoomCode(body.roomCode);
  const nickname = normalizeNickname(body.nickname);

  if (!roomCode) return fail(400, 'Room code must be six valid letters');
  if (!nickname) return fail(400, 'Nickname must be 1–20 characters without control characters');

  return withRoomMutation(roomCode, () => withRetry(async () => {
    const { room, etag } = await readRoom(s, roomCode);
    if (!room) return fail(404, 'Room not found — check the code and try again.');
    if (room.phase === 'closed' || isRoomExpired(room, Date.now())) return fail(410, 'This room has expired.');

    if (room.phase !== 'lobby') return fail(400, 'This game has already started.');

    const now = Date.now();
    room.players = room.players.filter(player => !isSessionExpired(player, now));
    room.players.forEach(player => {
      player.connected = now - (player.lastSeen || 0) < DISCONNECT_TIMEOUT_MS;
    });
    promoteHostIfDisconnected(room, now, DISCONNECT_TIMEOUT_MS);
    if (room.players.length >= MAX_PLAYERS) return fail(400, 'Room is full (6 players max).');

    const taken = room.players.some(p => p.nickname.toLowerCase() === nickname.toLowerCase());
    if (taken) return fail(400, 'That nickname is already taken in this room.');

    const playerId = generatePlayerId();
    room.players.push({
      id: playerId,
      nickname,
      role: null,
      connected: true,
      lastSeen: now
    });
    if (!room.players.some(player => player.id === room.hostId)) room.hostId = playerId;
    else promoteHostIfDisconnected(room, now, DISCONNECT_TIMEOUT_MS);
    touchRoom(room, now);

    const written = await writeRoom(s, roomCode, room, etag);
    if (!written) return 'RETRY';

    return ok({ roomCode, playerId, room: sanitize(room, playerId) });
  }));
}

async function handleGetState(s, body) {
  const roomCode = normalizeRoomCode(body.roomCode);
  const playerId = normalizePlayerId(body.playerId);

  if (!roomCode) return fail(400, 'Room code must be six valid letters');
  if (!playerId) return fail(400, 'Player session is required');
  if (body.flightInput !== undefined && body.flightInput !== null &&
      (!Number.isInteger(body.flightInput.x) || body.flightInput.x < -1 || body.flightInput.x > 1 ||
       !Number.isInteger(body.flightInput.y) || body.flightInput.y < -1 || body.flightInput.y > 1 ||
       !Number.isSafeInteger(body.flightInput.sequence) || body.flightInput.sequence < 1)) {
    return fail(400, 'Invalid flight input');
  }

  return withRoomMutation(roomCode, () => withRetry(async () => {
    const { room, etag } = await readRoom(s, roomCode);
    if (!room) return fail(404, 'Room not found');
    if (room.phase === 'closed') return fail(410, 'This room has expired.');

    const player = room.players.find(p => p.id === playerId);
    if (!player) return fail(403, 'You are not in this room');

    const now = Date.now();
    if (isSessionExpired(player, now)) return fail(410, 'Your player session has expired.');
    if (body.flightInput && room.hostId !== playerId) return fail(403, 'Only the host has flight control');
    if (room.phase !== 'playing' && isRoomExpired(room, now)) return fail(410, 'This room has expired.');

    // Update lastSeen for the polling player
    player.lastSeen = now;
    player.connected = true;

    // Refresh connection status for all players
    room.players.forEach(p => {
      p.connected = (now - (p.lastSeen || 0)) < DISCONNECT_TIMEOUT_MS;
    });

    // Tick game state (spawns emergencies, applies damage, checks win/lose)
    if (room.phase === 'playing') {
      if (room.round && !room.round.flight) {
        const legacyMatchId = room.matchId || room.round.matchId || `legacy-${room.round.startedAt}`;
        room.round.flight = createFlightState(legacyMatchId, room.round.lastTickAt || now);
      }
      tickGameState(room, now);
      if (body.flightInput && room.round?.flight) {
        if (room.hostId !== playerId) return fail(403, 'Only the host has flight control');
        const flight = room.round.flight;
        if (body.flightInput.sequence > (flight.inputSequence || 0)) {
          setFlightInput(flight, body.flightInput.x, body.flightInput.y, body.flightInput.sequence, now);
        }
      }
      // Ensure updatedAt always moves forward (monotonic)
      if (room.round) {
        const last = room.round.updatedAt || 0;
        room.round.updatedAt = Math.max(last + 1, now + 1);
      }
      if (room.phase === 'results') setResultsExpiry(room);
    }
    promoteHostIfDisconnected(room, now, DISCONNECT_TIMEOUT_MS);
    touchRoom(room, now);
    const written = await writeRoom(s, roomCode, room, etag);
    if (!written) return 'RETRY';

    return ok({ room: sanitize(room, playerId) });
  }));
}

async function handleSendChat(s, body) {
  const roomCode = normalizeRoomCode(body.roomCode);
  const playerId = normalizePlayerId(body.playerId);
  const actionId = typeof body.actionId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(body.actionId) ? body.actionId : null;
  const text = typeof body.text === 'string' ? body.text.normalize('NFC').trim() : '';
  if (!roomCode) return fail(400, 'Room code must be six valid letters');
  if (!playerId) return fail(400, 'Player session is required');
  if (!actionId) return fail(400, 'A valid message request ID is required');
  if (!text || text.length > MAX_CHAT_LENGTH || /[\u0000-\u001F\u007F-\u009F]/.test(text)) {
    return fail(400, `Message must be 1–${MAX_CHAT_LENGTH} characters without control characters`);
  }

  return withRoomMutation(roomCode, () => withRetry(async () => {
    const { room, etag } = await readRoom(s, roomCode);
    if (!room) return fail(404, 'Room not found');
    if (room.phase === 'closed' || isRoomExpired(room, Date.now())) return fail(410, 'This room has expired.');
    const player = room.players.find(candidate => candidate.id === playerId);
    if (!player) return fail(403, 'You are not in this room');
    const now = Date.now();
    if (isSessionExpired(player, now)) return fail(410, 'Your player session has expired.');

    room.chatMessages = Array.isArray(room.chatMessages) ? room.chatMessages : [];
    room.chatReceipts = Array.isArray(room.chatReceipts) ? room.chatReceipts : [];
    const receiptKey = `${playerId}:${actionId}`;
    if (room.chatReceipts.includes(receiptKey)) return ok({ room: sanitize(room, playerId), duplicate: true });
    room.chatRateWindows = room.chatRateWindows && typeof room.chatRateWindows === 'object' ? room.chatRateWindows : {};
    const recent = (room.chatRateWindows[playerId] || []).filter(timestamp => now - timestamp < CHAT_WINDOW_MS);
    if (recent.length >= CHAT_WINDOW_LIMIT) return fail(429, 'Chat rate limit reached. Wait a few seconds and try again.');
    recent.push(now);
    room.chatRateWindows[playerId] = recent;

    room.chatMessages.push({ id: randomUUID(), actionId, senderId: playerId, sender: player.nickname, text, timestamp: now });
    if (room.chatMessages.length > MAX_CHAT_MESSAGES) room.chatMessages.splice(0, room.chatMessages.length - MAX_CHAT_MESSAGES);
    room.chatReceipts.push(receiptKey);
    if (room.chatReceipts.length > 128) room.chatReceipts.splice(0, room.chatReceipts.length - 128);
    touchRoom(room, now);
    const written = await writeRoom(s, roomCode, room, etag);
    if (!written) return 'RETRY';
    return ok({ room: sanitize(room, playerId) });
  }));
}

async function handleStartGame(s, body) {
  const roomCode = normalizeRoomCode(body.roomCode);
  const playerId = normalizePlayerId(body.playerId);
  if (!roomCode) return fail(400, 'Room code must be six valid letters');
  if (!playerId) return fail(400, 'Player session is required');

  return withRoomMutation(roomCode, () => withRetry(async () => {
    const { room, etag } = await readRoom(s, roomCode);
    if (!room) return fail(404, 'Room not found');
    if (room.phase === 'closed' || isRoomExpired(room, Date.now())) return fail(410, 'This room has expired.');
    if (room.hostId !== playerId) return fail(403, 'Only the host can start the game');
    if (room.phase !== 'lobby') return fail(400, 'Game already started');

    const now = Date.now();
    const host = room.players.find(player => player.id === playerId);
    if (!host || isSessionExpired(host, now)) return fail(410, 'Your player session has expired.');
    room.players.forEach(player => {
      player.connected = player.id === playerId || now - (player.lastSeen || 0) < DISCONNECT_TIMEOUT_MS;
    });
    host.lastSeen = now;
    const connected = room.players.filter(p => p.connected);
    if (connected.length < MIN_PLAYERS_TO_START) {
      return fail(400, `Need at least ${MIN_PLAYERS_TO_START} players to start`);
    }

    const playersWithRoles = assignRoles(connected, room.hostId);
    const roleIds = [...new Set(playersWithRoles.flatMap(p => p.roles || [p.role]))];
    const schedule = generateEmergencySchedule(now, connected.length, roleIds);
    // Deterministic emergency for integration tests – only active when ENABLE_TEST_MODE is true
    if (isTestMode(body)) {
      schedule.unshift({
        id: `em_test_nav_${now}`,
        spawnAt: now + 2000,
        typeId: 'nav_failure',
        severity: 1
      });
    }
    // Deterministic nav_failure emergency for integration tests when ENABLE_TEST_MODE is true
    if (process.env.NODE_ENV === 'test' && process.env.ENABLE_TEST_MODE === 'true') {
      schedule.unshift({
        id: `em_test_nav_${now}`,
        spawnAt: now + 2000,
        typeId: 'nav_failure',
        severity: 1
      });
    }

    room.players = room.players.map(p => {
      const assigned = playersWithRoles.find(pr => pr.id === p.id);
      return assigned ? { ...p, role: assigned.role, roles: assigned.roles } : { ...p, role: null, roles: [] };
    });

    room.phase = 'playing';
    // Use shortened duration for test mode so integration tests finish quickly
    const roundDuration = getRoundDuration(body);
    const matchId = randomUUID();
    room.round = {
      matchId,
      flight: createFlightState(matchId, now),
      power: { allocations: { engines: 34, shields: 33, weapons: 33 }, energy: 100 },
      communicationTask: playersWithRoles.some(player => (player.roles || []).includes('communications_officer'))
        ? createSignalTask(now) : null,
      actionReceipts: [],
      startedAt: now,
      updatedAt: now,
      // expose round updatedAt for easier client checks
      duration: roundDuration,
      mission: createMissionState(roundDuration),
      contributions: {
        pilotManeuvers: 0, navigatorMarks: 0, navigatorDiversions: 0,
        engineerRepairs: 0, engineerHullRestored: 0, engineerShieldActivations: 0,
        gunnerShots: 0, gunnerAsteroidsDestroyed: 0,
        powerAllocations: 0, powerBoosts: 0, communicationsTasks: 0
      },
      crewEvents: [],
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
    room.matchId = room.round.matchId;
    room.lastActivityAt = now;
    setActiveMatchExpiry(room);
    room.rematchVotes = {};

    const written = await writeRoom(s, roomCode, room, etag);
    if (!written) return 'RETRY';

    return ok({ room: sanitize(room, playerId) });
  }));
}

async function handleSetCourse(s, body) {
  const roomCode = normalizeRoomCode(body.roomCode);
  const playerId = normalizePlayerId(body.playerId);
  const matchId = typeof body.matchId === 'string' && /^[a-f0-9-]{36}$/i.test(body.matchId) ? body.matchId : null;
  const actionId = typeof body.actionId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(body.actionId) ? body.actionId : null;
  const { inputX, inputY, inputSequence } = body;
  if (!roomCode) return fail(400, 'Room code must be six valid letters');
  if (!playerId) return fail(400, 'Player session is required');
  if (!matchId || !actionId) return fail(400, 'Valid matchId and actionId are required');
  if (![inputX, inputY].every(value => Number.isInteger(value) && value >= -1 && value <= 1) ||
      !Number.isSafeInteger(inputSequence) || inputSequence < 1) {
    return fail(400, 'Invalid flight control input');
  }

  return withRoomMutation(roomCode, () => withRetry(async () => {
    const { room, etag } = await readRoom(s, roomCode);
    if (!room) return fail(404, 'Room not found');
    if (room.phase === 'closed' || isRoomExpired(room, Date.now())) return fail(410, 'This room has expired.');
    if (room.phase !== 'playing' || !room.round?.flight) return fail(400, 'Flight controls are unavailable');
    if (room.hostId !== playerId) return fail(403, 'Only the host has flight control');
    const player = room.players.find(candidate => candidate.id === playerId);
    const now = Date.now();
    if (!player) return fail(403, 'You are not in this room');
    if (isSessionExpired(player, now)) return fail(410, 'Your player session has expired.');
    if (matchId !== room.matchId) return fail(409, 'This control belongs to an earlier match.');

    tickGameState(room, now);
    if (room.phase !== 'playing') {
      setResultsExpiry(room);
      const written = await writeRoom(s, roomCode, room, etag);
      if (!written) return 'RETRY';
      return fail(400, 'Game is not in progress');
    }

    const flight = room.round.flight;
    const receipt = `${playerId}:${actionId}`;
    flight.actionReceipts = Array.isArray(flight.actionReceipts) ? flight.actionReceipts : [];
    if (flight.actionReceipts.includes(receipt) || inputSequence <= flight.inputSequence) {
      room.round.updatedAt = Math.max((room.round.updatedAt || 0) + 1, now + 1);
      const written = await writeRoom(s, roomCode, room, etag);
      if (!written) return 'RETRY';
      return ok({ success: true, duplicate: true, room: sanitize(room, playerId) });
    }
    const previousX = flight.ship.inputX;
    const previousY = flight.ship.inputY;
    setFlightInput(flight, inputX, inputY, inputSequence, now);
    if (previousX !== flight.ship.inputX || previousY !== flight.ship.inputY) {
      const action = inputY < 0 ? 'thrusting forward' : inputY > 0 ? 'braking' : inputX < 0 ? 'steering left' : inputX > 0 ? 'steering right' : 'released the helm';
      ensureContributions(room.round).pilotManeuvers++;
      room.round.lastAction = {
        playerId,
        nickname: player.nickname,
        abilityId: 'flight_controls',
        abilityName: 'Flight controls',
        message: `Pilot ${action}.`,
        timestamp: now,
        eventId: `pilot:${matchId}:${actionId}`
      };
      recordCrewEvent(room.round, { ...room.round.lastAction, id: room.round.lastAction.eventId, type: 'pilot' });
    }
    flight.actionReceipts.push(receipt);
    flight.actionReceipts = flight.actionReceipts.slice(-64);
    room.round.updatedAt = Math.max((room.round.updatedAt || 0) + 1, now + 1);
    const written = await writeRoom(s, roomCode, room, etag);
    if (!written) return 'RETRY';
    return ok({ success: true, room: sanitize(room, playerId) });
  }));
}

async function handleMarkThreat(s, body) {
  const roomCode = normalizeRoomCode(body.roomCode);
  const playerId = normalizePlayerId(body.playerId);
  const matchId = typeof body.matchId === 'string' && /^[a-f0-9-]{36}$/i.test(body.matchId) ? body.matchId : null;
  const actionId = typeof body.actionId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(body.actionId) ? body.actionId : null;
  const asteroidId = typeof body.asteroidId === 'string' && /^rock_[A-Za-z0-9_-]{1,80}$/.test(body.asteroidId) ? body.asteroidId : null;
  if (!roomCode) return fail(400, 'Room code must be six valid letters');
  if (!playerId) return fail(400, 'Player session is required');
  if (!matchId || !actionId || !asteroidId) return fail(400, 'Valid match, action and asteroid IDs are required');

  return withRoomMutation(roomCode, () => withRetry(async () => {
    const { room, etag } = await readRoom(s, roomCode);
    if (!room) return fail(404, 'Room not found');
    if (room.phase === 'closed' || isRoomExpired(room, Date.now())) return fail(410, 'This room has expired.');
    if (room.phase !== 'playing' || !room.round?.flight) return fail(400, 'Threat marking is available during a mission.');
    const player = room.players.find(candidate => candidate.id === playerId);
    if (!player) return fail(403, 'You are not in this room');
    const now = Date.now();
    if (isSessionExpired(player, now)) return fail(410, 'Your player session has expired.');
    if (matchId !== room.matchId) return fail(409, 'This mark belongs to an earlier match.');
    if (!(player.roles || [player.role]).includes('navigator')) return fail(403, 'Only the Navigator can mark a threat.');

    tickGameState(room, now);
    if (room.phase !== 'playing') {
      setResultsExpiry(room);
      const written = await writeRoom(s, roomCode, room, etag);
      if (!written) return 'RETRY';
      return fail(400, 'Game is not in progress');
    }

    const round = room.round;
    round.actionReceipts = Array.isArray(round.actionReceipts) ? round.actionReceipts : [];
    const receipt = `${playerId}:${actionId}`;
    if (round.actionReceipts.includes(receipt)) {
      return ok({ success: true, duplicate: true, room: sanitize(room, playerId) });
    }
    const asteroid = round.flight.asteroids.find(item => item.id === asteroidId);
    if (!asteroid) return fail(404, 'That asteroid is no longer in this match.');
    const distance = Math.hypot(asteroid.x - round.flight.ship.x, asteroid.y - round.flight.ship.y);
    if (distance > .48) return fail(400, 'That asteroid is outside Navigator radar range.');

    const cooldownKey = `${playerId}__mark_threat`;
    const cooldownUntil = round.repairCooldowns[cooldownKey] || 0;
    if (now < cooldownUntil) {
      return fail(400, `Threat marking on cooldown for ${Math.ceil((cooldownUntil - now) / 1000)} more seconds`);
    }

    round.flight.navigatorMark = {
      asteroidId,
      matchId,
      nickname: player.nickname,
      expiresAt: now + 8000
    };
    round.repairCooldowns[cooldownKey] = now + 5000;
    ensureContributions(round).navigatorMarks++;
    round.lastAction = {
      playerId,
      nickname: player.nickname,
      abilityId: 'mark_threat',
      abilityName: 'Threat Mark',
      message: `Navigator ${player.nickname} marked an asteroid on radar. Pilot, check the threat ring.`,
      timestamp: now,
      eventId: `navigator:${matchId}:${actionId}`
    };
    recordCrewEvent(round, { ...round.lastAction, id: round.lastAction.eventId, type: 'navigator_mark' });
    round.actionReceipts.push(receipt);
    round.actionReceipts = round.actionReceipts.slice(-256);
    round.updatedAt = Math.max((round.updatedAt || 0) + 1, now + 1);

    const written = await writeRoom(s, roomCode, room, etag);
    if (!written) return 'RETRY';
    return ok({ success: true, room: sanitize(room, playerId) });
  }));
}

async function handlePlayerAction(s, body) {
  const roomCode = normalizeRoomCode(body.roomCode);
  const playerId = normalizePlayerId(body.playerId);
  const abilityId = typeof body.abilityId === 'string' && /^[a-z_]{1,40}$/.test(body.abilityId) ? body.abilityId : null;
  const matchId = typeof body.matchId === 'string' && /^[a-f0-9-]{36}$/i.test(body.matchId) ? body.matchId : null;
  const actionId = typeof body.actionId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(body.actionId) ? body.actionId : null;
  const targetEmergencyId = body.targetEmergencyId || null;
  const targetAsteroidId = body.targetAsteroidId || null;
  const targetSystem = body.targetSystem || null;

  if (!roomCode) return fail(400, 'Room code must be six valid letters');
  if (!playerId) return fail(400, 'Player session is required');
  if (!abilityId) return fail(400, 'Valid abilityId is required');
  if (!matchId) return fail(400, 'Valid matchId is required');
  if (!actionId) return fail(400, 'Valid actionId is required');
  if (targetEmergencyId !== null && (typeof targetEmergencyId !== 'string' || targetEmergencyId.length > 100)) {
    return fail(400, 'Invalid emergency target');
  }
  if (targetSystem !== null && (typeof targetSystem !== 'string' || targetSystem.length > 40)) {
    return fail(400, 'Invalid system target');
  }
  if (targetAsteroidId !== null && (typeof targetAsteroidId !== 'string' || !/^rock_[A-Za-z0-9_-]{1,80}$/.test(targetAsteroidId))) {
    return fail(400, 'Invalid asteroid target');
  }

  return withRoomMutation(roomCode, () => withRetry(async () => {
    const { room, etag } = await readRoom(s, roomCode);
    if (!room) return fail(404, 'Room not found');
    if (room.phase === 'closed' || isRoomExpired(room, Date.now())) return fail(410, 'This room has expired.');
    if (room.phase !== 'playing') return fail(400, 'Game is not in progress');

    const player = room.players.find(p => p.id === playerId);
    if (!player) return fail(404, 'You are not in this room');
    const now = Date.now();
    if (isSessionExpired(player, now)) return fail(410, 'Your player session has expired.');
    if (matchId !== room.matchId) return fail(409, 'This action belongs to an earlier match.');
    if (!player.role) return fail(400, 'Role not yet assigned');

    // Tick before accepting an action so a request at or after the deadline
    // cannot alter a match whose authoritative end time has already passed.
    tickGameState(room, now);
    if (room.phase !== 'playing') {
      setResultsExpiry(room);
      const written = await writeRoom(s, roomCode, room, etag);
      if (!written) return 'RETRY';
      return fail(400, 'Game is not in progress');
    }

    const abilityDef = (player.roles || [player.role])
      .map(roleId => ROLES.find(r => r.id === roleId))
      .flatMap(role => role?.abilities || [])
      .find(ability => ability.id === abilityId);
    const round = room.round;
    const receiptKey = `${playerId}:${actionId}`;
    round.actionReceipts = Array.isArray(round.actionReceipts) ? round.actionReceipts : [];
    if (round.actionReceipts.includes(receiptKey)) {
      round.updatedAt = Math.max((round.updatedAt || 0) + 1, now + 1);
      const written = await writeRoom(s, roomCode, room, etag);
      if (!written) return 'RETRY';
      return ok({ success: true, duplicate: true, room: sanitize(room, playerId) });
    }
    // ── Special: crew_respond — available to ALL players for radiation_burst ──────
    if (abilityId === 'crew_respond') {
      const crKey = `${playerId}__crew_respond`;
      const crUntil = round.repairCooldowns[crKey] || 0;
      if (now < crUntil) {
        return fail(400, `Crew response on cooldown for ${Math.ceil((crUntil - now) / 1000)} more seconds`);
      }
      const crEm = targetEmergencyId
        ? round.activeEmergencies.find(e => e.id === targetEmergencyId && !e.resolvedAt && e.typeId === 'radiation_burst')
        : round.activeEmergencies.find(e => !e.resolvedAt && e.typeId === 'radiation_burst');
      if (!crEm) return fail(400, 'No all-hands emergency to respond to right now.');

      // Inline resolve
      crEm.resolvedAt = now;
      crEm.resolvedBy = playerId;
      crEm.resolvedByNickname = player.nickname;
      round.emergenciesResolved = (round.emergenciesResolved || 0) + 1;
      if (now - crEm.spawnedAt <= 5000) round.speedBonuses = (round.speedBonuses || 0) + 1;
      recordMissionContribution(round, playerId);

      round.repairCooldowns[crKey] = now + 15000;
      round.lastAction = {
        playerId,
        nickname: player.nickname,
        abilityId: 'crew_respond',
        abilityName: 'Crew Response',
        message: `${player.nickname} responded to the radiation emergency.`,
        timestamp: now,
        eventId: `action:${matchId}:${actionId}`
      };
      recordCrewEvent(round, { ...round.lastAction, id: round.lastAction.eventId, type: 'emergency' });

      tickGameState(room, now);
      // Ensure updatedAt monotonic increase for crew_respond path
      if (room.round) {
        const last = room.round.updatedAt || 0;
        room.round.updatedAt = Math.max(last + 1, now + 1);
      }
      round.actionReceipts.push(receiptKey);
      round.actionReceipts = round.actionReceipts.slice(-256);
      setResultsExpiry(room);
      const crWritten = await writeRoom(s, roomCode, room, etag);
      if (!crWritten) return 'RETRY';
      return ok({ success: true, room: sanitize(room, playerId) });
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (!abilityDef) return fail(403, `Ability "${abilityId}" is not available for your role`);

    // ── Cooldown check ────────────────────────────────────────────
    const cdKey = `${playerId}__${abilityId}`;
    const cdUntil = round.repairCooldowns[cdKey] || 0;
    const allHands = isBuffActive(round, 'all_hands');

    if (now < cdUntil) {
      return fail(400, `Ability on cooldown for ${Math.ceil((cdUntil - now) / 1000)} more seconds`);
    }

    // ── Apply the ability ─────────────────────────────────────────
    const result = applyAbility({ abilityId, player, round, now, targetEmergencyId, targetSystem, targetAsteroidId });
    if (result.error) return fail(400, result.error);
    recordMissionContribution(round, playerId);

    // ── Set cooldown ──────────────────────────────────────────────
    let cd = abilityDef.cooldownMs;
    if (abilityId === 'pulse_cannon') {
      const weaponPower = round.power?.allocations?.weapons ?? 33;
      cd = Math.round(cd * (1.5 - weaponPower / 100));
    }
    if (allHands) cd = Math.floor(cd / 2);
    round.repairCooldowns[cdKey] = now + cd;

    // ── Broadcast last action ─────────────────────────────────────
    round.lastAction = {
      playerId,
      nickname: player.nickname,
      abilityId,
      abilityName: abilityDef.name,
      message: result.message || `${abilityDef.name} activated.`,
      timestamp: now,
      eventId: `action:${matchId}:${actionId}`
    };
    recordCrewEvent(round, { ...round.lastAction, id: round.lastAction.eventId, type: abilityId });
    const contributions = ensureContributions(round);
    if (abilityId === 'patch_hull' && result.hullRestored > 0) {
      contributions.engineerRepairs++;
      contributions.engineerHullRestored += result.hullRestored;
    } else if (abilityId === 'boost_shields') {
      contributions.engineerShieldActivations++;
    } else if (abilityId === 'evade' && result.divertedThreat) {
      contributions.navigatorDiversions++;
    } else if (abilityId === 'pulse_cannon' && result.weaponEvent) {
      contributions.gunnerShots++;
    } else if (abilityId === 'allocate_power') {
      contributions.powerAllocations++;
    } else if (abilityId === 'boost_engines') {
      contributions.powerBoosts++;
    } else if (abilityId === 'decode_signal') {
      contributions.communicationsTasks++;
    }

    // ── Tick state ────────────────────────────────────────────────
    tickGameState(room, now);
    // Ensure updatedAt always moves forward (monotonic)
    if (room.round) {
      const last = room.round.updatedAt || 0;
      room.round.updatedAt = Math.max(last + 1, now + 1);
    }
    round.actionReceipts.push(receiptKey);
    round.actionReceipts = round.actionReceipts.slice(-256);
    setResultsExpiry(room);

    const written = await writeRoom(s, roomCode, room, etag);
    if (!written) return 'RETRY';

    return ok({
      success: true,
      room: sanitize(room, playerId),
      cooldownUntil: round.repairCooldowns[cdKey]
    });
  }));
}

// ── Ability Implementations ───────────────────────────────────────────────────

function applyAbility({ abilityId, player, round, now, targetEmergencyId, targetSystem, targetAsteroidId }) {

  function findEM(typeFilter) {
    let pool = round.activeEmergencies.filter(e => !e.resolvedAt);
    if (typeFilter) pool = pool.filter(e => typeFilter.includes(e.typeId));
    if (targetEmergencyId) pool = pool.filter(e => e.id === targetEmergencyId);
    return pool[0] || null;
  }

  function resolveEM(em) {
    em.resolvedAt = now;
    em.resolvedBy = player.id;
    em.resolvedByNickname = player.nickname;
    round.emergenciesResolved = (round.emergenciesResolved || 0) + 1;
    if (now - em.spawnedAt <= 5000) {
      round.speedBonuses = (round.speedBonuses || 0) + 1;
    }
  }


  switch (abilityId) {
    case 'allocate_power': {
      let allocations;
      try { allocations = JSON.parse(targetSystem || ''); } catch { return { error: 'Power allocation must be valid JSON.' }; }
      if (!allocations || Object.keys(allocations).sort().join(',') !== 'engines,shields,weapons' ||
          !['engines', 'shields', 'weapons'].every(key => Number.isInteger(allocations[key]) && allocations[key] >= 0 && allocations[key] <= 100) ||
          allocations.engines + allocations.shields + allocations.weapons !== 100) {
        return { error: 'Engine, shield and weapon power must be whole percentages totaling 100.' };
      }
      round.power = round.power || { energy: 100 };
      round.power.allocations = allocations;
      return { success: true, message: `Power routed · engines ${allocations.engines}% · shields ${allocations.shields}% · weapons ${allocations.weapons}%.` };
    }
    case 'boost_engines': {
      if ((round.power?.energy ?? 100) < 30) return { error: 'Insufficient reserve energy for Engine Overdrive.' };
      round.power.energy = (round.power.energy ?? 100) - 30;
      addBuff(round, 'engine_overdrive', 8000);
      return { success: true, message: 'Engine Overdrive active for 8 seconds · reserve −30.' };
    }
    case 'decode_signal': {
      const task = round.communicationTask;
      if (!task || task.completedAt || task.expiredAt || now >= task.expiresAt) return { error: 'No active communications signal is available.' };
      if (targetSystem !== task.answerIndex) return { error: 'Signal mismatch. Compare the sequence and try again.' };
      task.completedAt = now;
      round.communicationScore = (round.communicationScore || 0) + 100;
      return { success: true, message: 'Signal decoded and confirmed. +100 team score.' };
    }
    case 'pulse_cannon': {
      if (!targetAsteroidId) return { error: 'No asteroid target is in pulse-cannon range.' };
      const shot = launchPulseCannonProjectile(round.flight, targetAsteroidId, player.id, now, round.matchId);
      if (shot.error) return shot;
      const message = `Gunner ${player.nickname} fired the Pulse Cannon. Projectile in flight.`;
      return { success: true, weaponEvent: shot.event, destroyed: shot.destroyed, message };
    }
    case 'patch_hull': {
      const previousHull = round.hullIntegrity;
      let emergencyResolved = false;
      // Engineer universal fallback: also mark a targeted emergency resolved
      if (targetEmergencyId) {
        const em = round.activeEmergencies.find(e => e.id === targetEmergencyId && !e.resolvedAt);
        if (!em) return { error: 'That emergency is no longer available to repair.' };
        resolveEM(em);
        emergencyResolved = true;
      } else {
        // Auto-resolve the most pressing resolvable emergency if no explicit target
        const em = round.activeEmergencies.find(e => !e.resolvedAt &&
          ['engine_fire', 'hull_breach'].includes(e.typeId));
        if (em) { resolveEM(em); emergencyResolved = true; }
      }
      const restored = Math.min(15, 100 - previousHull);
      if (restored <= 0 && !emergencyResolved) {
        return { error: 'Hull integrity is already at maximum; no repair is needed.' };
      }
      if (emergencyResolved && targetEmergencyId) {
        const emergency = round.activeEmergencies.find(em => em.id === targetEmergencyId);
        if (emergency?.typeId === 'rogue_asteroid' &&
            !divertAsteroidHazard(round.flight, emergency.id, now)) {
          return { error: 'The marked asteroid is no longer on an intercept course.' };
        }
      }
      round.hullIntegrity = Math.min(100, round.hullIntegrity + 15);
      const message = restored > 0
        ? `Engineer repaired ${Math.round(restored)} hull${emergencyResolved ? ' and resolved the emergency' : ''}.`
        : 'Engineer resolved the emergency; hull integrity was already full.';
      return { success: true, message, hullRestored: restored };
    }

    case 'boost_shields': {
      addBuff(round, 'boost_shields', 10000);
      return { success: true };
    }

    case 'evade': {
      const em = findEM(['rogue_asteroid', 'nav_failure']);
      if (!em) return { error: 'No asteroid or navigation emergency to evade right now.' };
      if (em.typeId === 'rogue_asteroid' && !divertAsteroidHazard(round.flight, em.id, now)) {
        return { error: 'The marked asteroid is no longer on an intercept course.' };
      }
      resolveEM(em);
      return {
        success: true,
        divertedThreat: em.typeId === 'rogue_asteroid',
        message: em.typeId === 'rogue_asteroid'
          ? 'Navigator diverted the marked asteroid. Pilot, steer through the clear lane.'
          : 'Navigator restored the ship navigation systems.'
      };
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
          typeId: next.typeId,
          name: def?.name || next.typeId,
          icon: def?.icon || '⚠️',
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
  const roomCode = normalizeRoomCode(body.roomCode);
  const playerId = normalizePlayerId(body.playerId);
  if (!roomCode) return fail(400, 'Room code must be six valid letters');
  if (!playerId) return fail(400, 'Player session is required');

  return withRoomMutation(roomCode, () => withRetry(async () => {
    const { room, etag } = await readRoom(s, roomCode);
    if (!room) return fail(404, 'Room not found');
    if (room.phase === 'closed' || isRoomExpired(room, Date.now())) return fail(410, 'This room has expired.');
    if (room.phase !== 'results') return fail(400, 'Game not finished yet');
    if (room.hostId !== playerId) return fail(403, 'Only the host can start a rematch');

    const now = Date.now();
    const rematchRevision = Math.max(now, (room.round?.updatedAt || 0) + 1);
    const roundDuration = getRoundDuration(body);
    const host = room.players.find(player => player.id === playerId);
    if (!host || isSessionExpired(host, now)) return fail(410, 'Your player session has expired.');
    room.players.forEach(player => {
      player.connected = player.id === playerId || now - (player.lastSeen || 0) < DISCONNECT_TIMEOUT_MS;
    });
    host.lastSeen = now;
    const connected = room.players.filter(player => player.connected);
    if (connected.length < MIN_PLAYERS_TO_START) {
      return fail(400, 'Need at least 2 players for a rematch');
    }

    const playersWithRoles = assignRoles(connected, room.hostId);
    const roleIds = [...new Set(playersWithRoles.flatMap(p => p.roles || [p.role]))];
    const schedule = generateEmergencySchedule(now, connected.length, roleIds);

    room.players = room.players.map(p => {
      const assigned = playersWithRoles.find(pr => pr.id === p.id);
      return assigned ? { ...p, role: assigned.role, roles: assigned.roles } : { ...p, role: null, roles: [] };
    });

    // Initialize game round with updatedAt and test-mode duration
    room.phase = 'playing';
    const matchId = randomUUID();
    room.round = {
      matchId,
      flight: createFlightState(matchId, now),
      power: { allocations: { engines: 34, shields: 33, weapons: 33 }, energy: 100 },
      communicationTask: playersWithRoles.some(player => (player.roles || []).includes('communications_officer'))
        ? createSignalTask(now) : null,
      actionReceipts: [],
      startedAt: now,
      // Use shortened duration for tests to ensure timely results
      duration: roundDuration,
      mission: createMissionState(roundDuration),
      contributions: {
        pilotManeuvers: 0, navigatorMarks: 0, navigatorDiversions: 0,
        engineerRepairs: 0, engineerHullRestored: 0, engineerShieldActivations: 0,
        gunnerShots: 0, gunnerAsteroidsDestroyed: 0,
        powerAllocations: 0, powerBoosts: 0, communicationsTasks: 0
      },
      crewEvents: [],
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
      updatedAt: rematchRevision // remains newer than every response from the previous match
    };
    room.matchId = room.round.matchId;
    room.lastActivityAt = now;
    setActiveMatchExpiry(room);
    room.rematchVotes = {};

    const written = await writeRoom(s, roomCode, room, etag);
    if (!written) return 'RETRY';

    return ok({ room: sanitize(room, playerId) });
  }));
}

async function handlePing(s, body) {
  const roomCode = normalizeRoomCode(body.roomCode);
  const playerId = normalizePlayerId(body.playerId);
  if (!roomCode) return fail(400, 'Room code must be six valid letters');
  if (!playerId) return fail(400, 'Player session is required');

  return withRoomMutation(roomCode, () => withRetry(async () => {
    const { room, etag } = await readRoom(s, roomCode);
    if (!room) return fail(404, 'Room not found');
    if (room.phase === 'closed' || isRoomExpired(room, Date.now())) return fail(410, 'This room has expired.');

    const player = room.players.find(p => p.id === playerId);
    if (!player) return fail(403, 'You are not in this room');
    const now = Date.now();
    if (isSessionExpired(player, now)) return fail(410, 'Your player session has expired.');
    player.lastSeen = now;
    player.connected = true;
    touchRoom(room, now);

    const written = await writeRoom(s, roomCode, room, etag);
    if (!written) return 'RETRY';
    return ok({ ok: true });
  }));
}

async function handleLeaveRoom(s, body) {
  const roomCode = normalizeRoomCode(body.roomCode);
  const playerId = normalizePlayerId(body.playerId);
  if (!roomCode) return fail(400, 'Room code must be six valid letters');
  if (!playerId) return fail(400, 'Player session is required');

  return withRoomMutation(roomCode, () => withRetry(async () => {
    const { room, etag } = await readRoom(s, roomCode);
    if (!room) return fail(404, 'Room not found');
    if (room.phase === 'closed' || isRoomExpired(room, Date.now())) return fail(410, 'This room has expired.');
    if (room.phase === 'playing') return fail(409, 'You can reconnect to this match if you close the page.');

    const player = room.players.find(candidate => candidate.id === playerId);
    if (!player) return fail(403, 'You are not in this room');
    const now = Date.now();
    if (isSessionExpired(player, now)) return fail(410, 'Your player session has expired.');

    room.players = room.players.filter(candidate => candidate.id !== playerId);
    if (room.hostId === playerId) {
      const successor = room.players.find(candidate => now - (candidate.lastSeen || 0) < DISCONNECT_TIMEOUT_MS);
      if (successor) room.hostId = successor.id;
      else if (room.players.length > 0) room.hostId = room.players[0].id;
    }
    if (room.players.length === 0) closeRoom(room, now);
    else touchRoom(room, now);

    const written = await writeRoom(s, roomCode, room, etag);
    if (!written) return 'RETRY';
    return ok({ left: true });
  }));
}

// ════════════════════════════════════════════════════════════════════════════
// Sanitize Room for Client
// Strips server-only fields, adds computed fields, scopes cooldowns to requester
// ════════════════════════════════════════════════════════════════════════════
function sanitize(room, myPlayerId) {
  const now = Date.now();

  // Build public player list with flags and hide secret IDs
  const players = room.players.map((p, idx) => ({
    publicId: `pid_${idx + 1}`,
    nickname: p.nickname,
    role: p.role,
    roles: p.roles || (p.role ? [p.role] : []),
    connected: p.connected,
    isHost: p.id === room.hostId,
    isMe: p.id === myPlayerId
  }));

  const out = {
    roomCode: room.roomCode,
    phase: room.phase,
    matchId: room.matchId || null,
    isHost: room.hostId === myPlayerId,
    canControlShip: room.hostId === myPlayerId,
    updatedAt: room.round ? room.round.updatedAt : undefined,
    players,
    chatMessages: (Array.isArray(room.chatMessages) ? room.chatMessages : []).slice(-MAX_CHAT_MESSAGES).map(({ id, sender, senderId, text, timestamp }) => ({ id, sender, isMe: senderId === myPlayerId, text, timestamp }))
  };

  if (room.phase === 'playing' && room.round) {
    const r = room.round;
    const elapsed = now - r.startedAt;
    const remaining = Math.max(0, r.duration - elapsed);

    // Compute cooldowns for this player
    const myCooldowns = {};
    for (const key of Object.keys(r.repairCooldowns)) {
      if (key.startsWith(`${myPlayerId}__`)) {
        const abilityId = key.split('__')[1];
        myCooldowns[abilityId] = Math.max(0, r.repairCooldowns[key] - now);
      }
    }

    // Map active emergencies, hide secret IDs
    const activeEmergencies = (r.activeEmergencies || []).map(em => {
      const def = EMERGENCY_TYPES.find(e => e.id === em.typeId) || {};
      return {
        id: em.id,
        typeId: em.typeId,
        name: def.name || em.typeId,
        icon: def.icon || '⚠️',
        description: def.description || '',
        severity: em.severity,
        spawnedAt: em.spawnedAt,
        expiresAt: em.expiresAt,
        resolvedAt: em.resolvedAt,
        resolvedByNickname: em.resolvedByNickname,
        timeLeftMs: em.resolvedAt ? 0 : Math.max(0, em.expiresAt - now),
        resolveRole: def.resolveRole || null,
        altRole: def.altRole || null,
        anyCanResolve: !def.resolveRole
      };
    });
    const missionProgress = getMissionProgress(r);
    const unresolvedEmergencies = activeEmergencies
      .filter(emergency => !emergency.resolvedAt)
      .sort((a, b) => a.timeLeftMs - b.timeLeftMs);
    const nextThreat = unresolvedEmergencies[0]
      ? `${unresolvedEmergencies[0].name} · ${Math.ceil(unresolvedEmergencies[0].timeLeftMs / 1000)}s`
      : r.broadcastAlert?.name
        ? `Incoming · ${r.broadcastAlert.name}`
        : 'No immediate alert';
    const threatRadar = getThreatRadar(r.flight, now, room.matchId);

    out.round = {
      remainingMs: remaining,
      elapsedMs: elapsed,
      updatedAt: r.updatedAt || r.startedAt || 0,
      hullIntegrity: Math.max(0, Math.round(r.hullIntegrity * 10) / 10),
      score: (r.score || 0) + (r.communicationScore || 0),
      communicationScore: r.communicationScore || 0,
      emergenciesResolved: r.emergenciesResolved || 0,
      mission: {
        name: 'Survive the Signal',
        objective: missionProgress.requiredEmergencyResolutions
          ? `Survive ${Math.ceil(r.duration / 1000)} seconds, resolve ${missionProgress.requiredEmergencyResolutions} emergencies, and have ${missionProgress.requiredCrewMembers} crew members use an ability.`
          : 'Keep the ship intact until the timer ends.',
        ...missionProgress,
        outstandingEmergencies: unresolvedEmergencies.length,
        nextThreat,
        status: missionProgress.complete
          ? 'Crew response goals secured · protect the hull to the end'
          : 'Mission in progress · coordinate pilot and crew actions'
      },
      broadcastAlert: r.broadcastAlert,
      lastAction: r.lastAction,
      contributions: { ...(r.contributions || {}) },
      crewEvents: (r.crewEvents || []).map(event => ({
        id: event.id, type: event.type, nickname: event.nickname,
        message: event.message, timestamp: event.timestamp
      })),
      activeBuffs: (r.activeBuffs || []).map(b => ({ id: b.id, remainingMs: b.expiresAt - now })),
      activeEmergencies,
    power: r.power ? { allocations: { ...r.power.allocations }, energy: r.power.energy } : null,
      communicationTask: r.communicationTask ? {
        id: r.communicationTask.id,
        sequence: r.communicationTask.sequence,
        options: r.communicationTask.options,
        expiresAt: r.communicationTask.expiresAt,
        completedAt: r.communicationTask.completedAt,
        expiredAt: r.communicationTask.expiredAt
      } : null,
      flight: r.flight ? {
        matchId: r.matchId || room.matchId,
        snapshotAt: now,
        inputSequence: r.flight.inputSequence || 0,
        ship: { ...r.flight.ship },
        asteroids: (r.flight.asteroids || []).map(asteroid => ({ ...asteroid })),
        threatRadar,
        markedThreat: threatRadar.markedThreat,
        collisionEvents: (r.flight.collisionEvents || []).map(event => ({ ...event })),
        navigationEvents: (r.flight.navigationEvents || []).map(event => ({ ...event })),
        weaponEvents: (r.flight.weaponEvents || []).map(({ shooterId, ...event }) => ({ ...event })),
        projectiles: (r.flight.projectiles || []).map(({ shooterId, ...projectile }) => ({ ...projectile }))
      } : null,
      myCooldowns
    };
  }

  if (room.phase === 'results' && room.round) {
    const r = room.round;
    out.results = {
      outcome: r.outcome,
      finalScore: r.finalScore || 0,
      survivedSeconds: r.survivedSeconds || 0,
      emergenciesResolved: r.emergenciesResolved || 0,
      speedBonuses: r.speedBonuses || 0,
      hullIntegrity: Math.round((r.hullIntegrity || 0) * 10) / 10,
      causeOfDeath: r.causeOfDeath || null,
      roundDurationSeconds: r.roundDurationSeconds || Math.ceil((r.duration || ROUND_DURATION_MS) / 1000),
      scoreBreakdown: r.scoreBreakdown || null,
      mission: {
        requiredEmergencyResolutions: r.mission?.requiredEmergencyResolutions || 0,
        emergenciesResolved: r.emergenciesResolved || 0,
        requiredCrewMembers: r.mission?.requiredCrewMembers || 0,
        crewMembersContributed: new Set(r.mission?.crewMemberIds || []).size,
        complete: getMissionProgress(r).complete
      },
      roleContributions: (() => {
        const contributions = r.contributions || {};
        const pilot = room.players.find(player => player.id === room.hostId);
        const hasRole = (player, role) => (player.roles || [player.role]).includes(role);
        const navigator = room.players.find(player => hasRole(player, 'navigator'));
        const engineer = room.players.find(player => hasRole(player, 'engineer'));
        return {
          pilot: { nickname: pilot?.nickname || null, maneuvers: contributions.pilotManeuvers || 0 },
          navigator: {
            nickname: navigator?.nickname || null,
            threatsMarked: contributions.navigatorMarks || 0,
            threatsDiverted: contributions.navigatorDiversions || 0
          },
          engineer: {
            nickname: engineer?.nickname || null,
            repairs: contributions.engineerRepairs || 0,
            hullRestored: contributions.engineerHullRestored || 0,
            shieldsActivated: contributions.engineerShieldActivations || 0
          },
          gunner: {
            nickname: room.players.find(player => hasRole(player, 'gunner'))?.nickname || null,
            shots: contributions.gunnerShots || 0,
            asteroidsDestroyed: contributions.gunnerAsteroidsDestroyed || 0
          },
          powerOperator: {
            nickname: room.players.find(player => hasRole(player, 'power_operator'))?.nickname || null,
            allocations: contributions.powerAllocations || 0,
            boosts: contributions.powerBoosts || 0
          },
          communicationsOfficer: {
            nickname: room.players.find(player => hasRole(player, 'communications_officer'))?.nickname || null,
            tasksCompleted: contributions.communicationsTasks || 0
          }
        };
      })()
    };
  }

  return out;
}


// Export functions for testing
module.exports.sanitize = sanitize;
module.exports.writeRoom = writeRoom;
module.exports.store = store;
module.exports.readRoom = readRoom;

// Export store for testing the local initialization
module.exports._store = store;
module.exports._setStoreProviderForTests = provider => { testStoreProvider = provider; };

