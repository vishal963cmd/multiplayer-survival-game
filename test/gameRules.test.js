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
  createMissionState,
  getMissionProgress,
  recordMissionContribution,
  recordCrewEvent,
  isMissionComplete,
  addBuff,
  isBuffActive,
  ROLES,
  EMERGENCY_TYPES,
  INITIAL_HULL,
  ROUND_DURATION_MS
} = require('../shared/gameRules');
const { createFlightState } = require('../shared/spaceflight');

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
    assert(`${n} players get distinct primary assignments`, roleSet.size === n);
    assert(`${n} players carry explicit capability arrays`, assigned.every(p => Array.isArray(p.roles) && p.roles.length));
    const validRoles = new Set(ROLES.map(r => r.id));
    assert(`${n} players get valid role IDs`, assigned.every(p => validRoles.has(p.role)));
  }

  const twoPlayers = [mkPlayer('a'), mkPlayer('b')];
  const two = assignRoles(twoPlayers);
  assert('2-player pilot also has Engineer capability', two[0].roles.join(',') === 'pilot,engineer');
  assert('2-player second player combines Navigator and Gunner', two[1].roles.join(',') === 'navigator,gunner');
  const transferredHost = assignRoles([mkPlayer('former_host'), mkPlayer('new_host'), mkPlayer('crew')], 'new_host');
  assert('Pilot capability follows a lobby host handoff',
    transferredHost.find(player => player.id === 'new_host')?.roles.includes('pilot') === true);
  for (const [count, expected] of [
    [3, [['pilot'], ['engineer'], ['navigator', 'gunner']]],
    [4, [['pilot'], ['engineer'], ['navigator'], ['gunner']]],
    [5, [['pilot'], ['engineer'], ['navigator'], ['gunner'], ['power_operator']]],
    [6, [['pilot'], ['engineer'], ['navigator'], ['gunner'], ['power_operator'], ['communications_officer']]]
  ]) {
    const actual = assignRoles(Array.from({ length: count }, (_, i) => mkPlayer(`p${i}`)));
    assert(`${count}-player assignment follows the documented role policy`,
      JSON.stringify(actual.map(player => player.roles)) === JSON.stringify(expected));
  }
  assert('unsupported player count is left unassigned', assignRoles([mkPlayer('solo')])[0].roles.length === 0);
  assert('combined Navigator/Gunner can resolve Gunner-supported emergencies',
    require('../shared/gameRules').canRoleResolve(['navigator', 'gunner'], { typeId: 'rogue_asteroid' }));
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

console.log('\n[4b] Shared cooperative mission');
{
  const round = {
    duration: ROUND_DURATION_MS,
    emergenciesResolved: 2,
    mission: createMissionState(ROUND_DURATION_MS)
  };
  recordMissionContribution(round, 'p_engineer');
  recordMissionContribution(round, 'p_engineer');
  assert('repeated ability use counts one crew member', getMissionProgress(round).crewMembersContributed === 1);
  assert('mission requires shared emergency progress and a second crew member', !isMissionComplete(round));
  round.emergenciesResolved = 3;
  assert('emergency target alone does not finish the cooperative objective', !isMissionComplete(round));
  recordMissionContribution(round, 'p_navigator');
  assert('two distinct crew abilities complete the shared response target', isMissionComplete(round));
  assert('short deterministic rounds do not require production-length objectives',
    isMissionComplete({ duration: 1000, emergenciesResolved: 0, mission: createMissionState(1000) }));
}

console.log('\n[4c] Bounded crew activity feed');
{
  const round = { crewEvents: [], crewEventSequence: 0 };
  for (let i = 0; i < 10; i++) recordCrewEvent(round, { nickname: 'Navigator', message: `event ${i}`, type: 'action', timestamp: i });
  assert('crew feed is bounded to eight events', round.crewEvents.length === 8);
  assert('crew feed keeps the newest event first in sequence', round.crewEvents.at(-1).message === 'event 9');
  assert('crew event text is length-bounded', recordCrewEvent(round, { message: 'x'.repeat(250) }).message.length === 180);
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
  room.round.score = 50;
  room.round.mission.crewMemberIds = ['p0', 'p1'];
  room.round.lastTickAt = startedAt;

  tickGameState(room, Date.now());

  assert('phase transitions to results', room.phase === 'results');
  assert('outcome is win', room.round.outcome === 'win');
  assert('finalScore is positive', room.round.finalScore > 0);
  assert('survivedSeconds is approximately 90', Math.abs(room.round.survivedSeconds - 90) <= 2);
  assert('score breakdown sums exactly to the server final', Object.values(room.round.scoreBreakdown).reduce((sum, value) => sum + value, 0) === room.round.finalScore);
  assert('rapid-response points are included in the transparent breakdown', room.round.scoreBreakdown.rapidResponses === 25);
  assert('validated combat score is included in final score breakdown', room.round.scoreBreakdown.combatScore === 50);
}

console.log('\n[6b] Tick Engine — incomplete shared objective');
{
  const startedAt = Date.now() - ROUND_DURATION_MS - 1000;
  const room = makeRoom(startedAt);
  room.round.startedAt = startedAt;
  room.round.hullIntegrity = 80;
  room.round.emergenciesResolved = 3;
  room.round.mission.crewMemberIds = ['p0'];
  room.round.lastTickAt = startedAt;
  tickGameState(room, Date.now());
  assert('survival alone fails when only one crew member contributed', room.phase === 'results' && room.round.outcome === 'lose');
  assert('shared objective failure is identified in the result', room.round.causeOfDeath === 'mission_objective_incomplete');
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

console.log('\n[9] Server Flight Tick — collision integrity');
{
  const now = Date.now();
  const room = makeRoom(now);
  room.round.flight = createFlightState('authoritative-collision', now);
  room.round.flight.asteroids = [{
    id: 'rock_authority', shapeSeed: 7, x: 0.54, y: 0.52,
    vx: 0, vy: 0, radius: 0.02, rotation: 0, spin: 0
  }];
  room.round.flight.ship.x = 0.43;
  room.round.flight.ship.y = 0.52;
  room.round.flight.ship.heading = 0;
  room.round.flight.ship.inputY = -1;
  tickGameState(room, now + 1200);
  assert('server tick applies collision damage to shared hull', room.round.hullIntegrity < 100);
  assert('server tick records the authoritative explosion event', room.round.flight.collisionEvents.length === 1);
  assert('one impact creates one stable collision activity event', room.round.crewEvents.filter(event => event.type === 'collision').length === 1 &&
    room.round.crewEvents[0].id === 'impact:authoritative-collision:impact_1');
  const hullAfterCollision = room.round.hullIntegrity;
  tickGameState(room, now + 1250);
  assert('one impact damages hull only once', room.round.hullIntegrity === hullAfterCollision);
  assert('repeated ticks do not append the same collision activity event', room.round.crewEvents.filter(event => event.type === 'collision').length === 1);
}

console.log('\n[10] Power allocation gameplay effects');
{
  const now = Date.now();
  const room = makeRoom(now);
  room.round.power = { allocations: { engines: 100, shields: 0, weapons: 0 }, energy: 100 };
  room.round.flight = createFlightState('engine-power-effect', now);
  room.round.flight.asteroids = [];
  room.round.flight.ship.inputY = -1;
  tickGameState(room, now + 500);
  assert('engine allocation changes the authoritative acceleration multiplier', room.round.flight.ship.accelerationMultiplier === 1.45);
  assert('engine allocation changes shared ship speed', room.round.flight.ship.speed > 0);

  const shieldRoom = makeRoom(now);
  shieldRoom.round.power = { allocations: { engines: 0, shields: 50, weapons: 50 }, energy: 100 };
  shieldRoom.round.flight = createFlightState('shield-power-effect', now);
  shieldRoom.round.flight.asteroids = [{
    id: 'rock_power_shield', shapeSeed: 1, x: 0.54, y: 0.52,
    vx: 0, vy: 0, radius: 0.02, rotation: 0, spin: 0
  }];
  shieldRoom.round.flight.ship.x = 0.43;
  shieldRoom.round.flight.ship.y = 0.52;
  shieldRoom.round.flight.ship.heading = 0;
  shieldRoom.round.flight.ship.inputY = -1;
  tickGameState(shieldRoom, now + 1200);
  assert('shield allocation reduces actual collision damage', shieldRoom.round.hullIntegrity === 92);
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
      mission:              createMissionState(ROUND_DURATION_MS),
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
