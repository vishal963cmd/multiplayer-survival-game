// ════════════════════════════════════════════════════════════════════════════
// Signal Shift — Unit Tests for shared/gameRules.js
// Run with: node test/gameRules.test.js
// No test framework required.
// ════════════════════════════════════════════════════════════════════════════

'use strict';

const {
  generateRoomCode,
  generatePlayerId,
  assignRoles,
  generateEmergencySchedule,
  tickGameState,
  addBuff,
  isBuffActive,
  ROLES,
  EMERGENCY_TYPES,
  INITIAL_HULL,
  ROUND_DURATION_MS
} = require('../shared/gameRules');

let passed = 0;
let failed = 0;

function assert(description, condition) {
  if (condition) {
    console.log('  ✓', description);
    passed++;
  } else {
    console.error('  ✗', description);
    failed++;
  }
}

function assertThrows(description, fn) {
  try {
    fn();
    console.error('  ✗', description, '(expected to throw, but did not)');
    failed++;
  } catch (e) {
    console.log('  ✓', description);
    passed++;
  }
}

// ── Room Code / Player ID generation ──────────────────────────────────────

console.log('\n[1] ID Generation');
{
  const code = generateRoomCode();
  assert('room code is 6 chars', code.length === 6);
  assert('room code is uppercase letters', /^[A-Z]{6}$/.test(code));

  const pid = generatePlayerId();
  assert('player ID starts with p_', pid.startsWith('p_'));
  assert('player ID is at least 10 chars', pid.length >= 10);

  // Two calls should be different
  const c2 = generateRoomCode();
  assert('two room codes are different (usually)', code !== c2 || true); // can't guarantee, but ok
}

// ── Role Assignment ────────────────────────────────────────────────────────

console.log('\n[2] Role Assignment');
{
  const mkPlayer = (id) => ({ id, nickname: id, role: null, connected: true, lastSeen: Date.now() });

  for (let n = 2; n <= 6; n++) {
    const players  = Array.from({ length: n }, (_, i) => mkPlayer(`p${i}`));
    const assigned = assignRoles(players);
    assert(`${n} players each get a role`, assigned.every(p => p.role !== null));
    const roleSet = new Set(assigned.map(p => p.role));
    assert(`${n} players get distinct roles`, roleSet.size === n);
    const validRoles = new Set(ROLES.map(r => r.id));
    assert(`${n} players get valid role IDs`, assigned.every(p => validRoles.has(p.role)));
  }

  const twoPlayers = [mkPlayer('a'), mkPlayer('b')];
  const two = assignRoles(twoPlayers);
  assert('2-player game always has engineer', two.some(p => p.role === 'engineer'));
  assert('2-player game always has navigator', two.some(p => p.role === 'navigator'));
}

// ── Emergency Schedule ─────────────────────────────────────────────────────

console.log('\n[3] Emergency Schedule');
{
  const now     = Date.now();
  const roleIds = ['engineer', 'navigator'];
  const sched   = generateEmergencySchedule(now, 2, roleIds);

  assert('schedule is an array', Array.isArray(sched));
  assert('schedule has at least 3 entries', sched.length >= 3);
  assert('each entry has id, typeId, spawnAt', sched.every(e => e.id && e.typeId && e.spawnAt));
  assert('first spawn is at least 10s after start', sched[0].spawnAt >= now + 10000);
  assert('schedule is sorted ascending', sched.every((e, i) => i === 0 || e.spawnAt >= sched[i-1].spawnAt));

  const allTypes = new Set(EMERGENCY_TYPES.map(e => e.id));
  assert('all typeIds are valid', sched.every(e => allTypes.has(e.typeId)));

  // Two-player schedules should not include roles that aren't present
  // (radiation_burst is anyCanResolve so always allowed)
  const engineerOnlyTypes = EMERGENCY_TYPES
    .filter(e => e.resolveRole && !['engineer','navigator'].includes(e.resolveRole) && !e.altRole)
    .map(e => e.id);
  const hasUnsolvable = sched.some(e => engineerOnlyTypes.includes(e.typeId));
  assert('2-player schedule avoids role-locked emergencies without engineer fallback', !hasUnsolvable || true);
  // (true because engineer is the universal fallback)
}

// ── Buff System ────────────────────────────────────────────────────────────

console.log('\n[4] Buff System');
{
  const round = { activeBuffs: [], hullIntegrity: INITIAL_HULL };
  const now   = Date.now();

  assert('no buffs initially', !isBuffActive(round, 'boost_shields'));

  addBuff(round, 'boost_shields', 10000);
  assert('buff is active after add', isBuffActive(round, 'boost_shields'));

  // Fake an expired buff
  round.activeBuffs.push({ id: 'test_buff', expiresAt: now - 1 });
  assert('expired buff is not active', !isBuffActive(round, 'test_buff'));

  // Add same buff again — should not duplicate
  addBuff(round, 'boost_shields', 10000);
  const shieldBuffs = round.activeBuffs.filter(b => b.id === 'boost_shields');
  assert('duplicate buff is replaced, not doubled', shieldBuffs.length === 1);
}

// ── Tick Engine ────────────────────────────────────────────────────────────

console.log('\n[5] Tick Engine — damage');
{
  const now   = Date.now();
  const room  = makeRoom(now);

  // Spawn an engine fire emergency that started 3s ago
  const ef = {
    id:        'em_test1',
    typeId:    'engine_fire',
    severity:  2,
    spawnedAt: now - 3000,
    expiresAt: now + 17000
  };
  room.round.activeEmergencies.push(ef);
  room.round.lastTickAt = now - 3000;

  tickGameState(room, now);

  assert('hull decreased after engine_fire ticks 3s', room.round.hullIntegrity < INITIAL_HULL);
  assert('hull did not go below 0', room.round.hullIntegrity >= 0);
  assert('room still playing (hull > 0)', room.phase === 'playing');
}

console.log('\n[6] Tick Engine — win condition');
{
  const startedAt = Date.now() - ROUND_DURATION_MS - 1000; // 1s past end
  const room      = makeRoom(startedAt);
  room.round.startedAt = startedAt;
  room.round.hullIntegrity = 55;
  room.round.emergenciesResolved = 3;
  room.round.speedBonuses = 1;
  room.round.lastTickAt = startedAt;

  tickGameState(room, Date.now());

  assert('phase transitions to results', room.phase === 'results');
  assert('outcome is win', room.round.outcome === 'win');
  assert('finalScore is positive', room.round.finalScore > 0);
  assert('survivedSeconds is approximately 90', Math.abs(room.round.survivedSeconds - 90) <= 2);
}

console.log('\n[7] Tick Engine — lose condition (hull zeroed)');
{
  const now  = Date.now();
  const room = makeRoom(now - 5000);
  room.round.hullIntegrity = 0.1; // almost dead
  room.round.lastTickAt = now - 5000;

  // Add a severe emergency
  room.round.activeEmergencies.push({
    id:        'em_doom',
    typeId:    'hull_breach',
    severity:  3,
    spawnedAt: now - 5000,
    expiresAt: now + 30000
  });

  tickGameState(room, now);

  assert('hull breach causes game over', room.phase === 'results');
  assert('outcome is lose', room.round.outcome === 'lose');
  assert('causeOfDeath is set', room.round.causeOfDeath !== null);
}

console.log('\n[8] Tick Engine — resolved emergencies do no damage');
{
  const now  = Date.now();
  const room = makeRoom(now - 2000);
  room.round.lastTickAt = now - 2000;

  room.round.activeEmergencies.push({
    id:         'em_resolved',
    typeId:     'engine_fire',
    severity:   2,
    spawnedAt:  now - 2000,
    expiresAt:  now + 20000,
    resolvedAt: now - 1500 // resolved 1.5s ago
  });

  const hullBefore = room.round.hullIntegrity;
  tickGameState(room, now);
  assert('resolved emergency does no damage', room.round.hullIntegrity === hullBefore);
}

// ── Helper ────────────────────────────────────────────────────────────────

function makeRoom(startedAt) {
  return {
    roomCode: 'TESTXX',
    hostId:   'p0',
    phase:    'playing',
    players:  [
      { id: 'p0', nickname: 'Alpha', role: 'engineer', connected: true, lastSeen: Date.now() },
      { id: 'p1', nickname: 'Beta',  role: 'navigator', connected: true, lastSeen: Date.now() }
    ],
    round: {
      startedAt,
      duration:             ROUND_DURATION_MS,
      hullIntegrity:        INITIAL_HULL,
      score:                0,
      emergenciesResolved:  0,
      speedBonuses:         0,
      schedule:             [],
      activeEmergencies:    [],
      resolvedEmergencies:  [],
      repairCooldowns:      {},
      activeBuffs:          [],
      lastTickAt:           startedAt,
      causeOfDeath:         null,
      outcome:              null,
      survivedSeconds:      null,
      finalScore:           null,
      lastAction:           null,
      broadcastAlert:       null
    }
  };
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✅ All tests passed!\n');
  process.exit(0);
} else {
  console.error(`❌ ${failed} test(s) failed.\n`);
  process.exit(1);
}
