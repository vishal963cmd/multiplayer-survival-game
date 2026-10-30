'use strict';

const assert = require('node:assert/strict');
const game = require('../netlify/functions/game');
const lifecycle = require('../shared/roomLifecycle');
const { createMissionState } = require('../shared/gameRules');

function createMockStore() {
  const rooms = new Map();
  let version = 0;
  return {
    rooms,
    async getWithMetadata(key) {
      const entry = rooms.get(key);
      return entry ? { data: structuredClone(entry.data), etag: entry.etag } : null;
    },
    async setJSON(key, data, options = {}) {
      const current = rooms.get(key);
      if (options.onlyIfNew && current) return { modified: false };
      if (options.onlyIfMatch && current?.etag !== options.onlyIfMatch) return { modified: false };
      const etag = `"${++version}"`;
      rooms.set(key, { data: structuredClone(data), etag });
      return { modified: true, etag };
    },
    async delete(key) { rooms.delete(key); },
    list: async function* () { yield { blobs: [...rooms.keys()].map(key => ({ key })) }; }
  };
}

function request(action, payload = {}, options = {}) {
  const httpMethod = options.method || 'POST';
  const headers = options.headers || { 'content-type': 'application/json' };
  const body = options.rawBody === undefined ? JSON.stringify({ action, ...payload }) : options.rawBody;
  return game.handler({ httpMethod, headers, body, queryStringParameters: options.query || {} });
}

async function call(action, payload = {}) {
  const response = await request(action, payload);
  return { status: response.statusCode, data: JSON.parse(response.body || '{}') };
}

async function main() {
  const originalDateNow = Date.now;
  const originalDev = process.env.NETLIFY_DEV;
  const originalTestMode = process.env.ENABLE_TEST_MODE;
  const originalTestDuration = process.env.TEST_ROUND_DURATION_MS;
  let now = 2_000_000_000_000;
  Date.now = () => now;
  delete process.env.NETLIFY_DEV;
  process.env.ENABLE_TEST_MODE = 'true';
  process.env.TEST_ROUND_DURATION_MS = '1000';

  const store = createMockStore();
  game._setStoreProviderForTests(() => store);
  try {
    assert.equal(game.config.rateLimit.windowLimit, 300);
    assert.deepEqual(game.config.rateLimit.aggregateBy, ['ip', 'domain']);

    const created = await call('create_room', { nickname: 'MockHost' });
    assert.equal(created.status, 200);
    const joined = await call('join_room', { roomCode: created.data.roomCode, nickname: 'MockGuest' });
    assert.equal(joined.status, 200);
    const isolatedRoom = await call('create_room', { nickname: 'OtherRoom' });

    const reconnect = await call('get_state', { roomCode: created.data.roomCode, playerId: joined.data.playerId });
    assert.equal(reconnect.status, 200);
    assert.equal(reconnect.data.room.players.length, 2);

    const chatPayload = { roomCode: created.data.roomCode, playerId: created.data.playerId, actionId: 'chat-message-0001', text: '  <b>Hold formation</b>  ' };
    assert.equal((await call('send_chat', { ...chatPayload, text: '   ' })).status, 400);
    assert.equal((await call('send_chat', { ...chatPayload, text: 'x'.repeat(501) })).status, 400);
    assert.equal((await call('send_chat', { ...chatPayload, playerId: 'p_aaaaaaaa' })).status, 403);
    const postedChat = await call('send_chat', chatPayload);
    assert.equal(postedChat.status, 200);
    assert.equal(postedChat.data.room.chatMessages[0].sender, 'MockHost');
    assert.equal(postedChat.data.room.chatMessages[0].text, '<b>Hold formation</b>');
    assert.equal((await call('send_chat', chatPayload)).data.duplicate, true);
    const guestChat = await call('get_state', { roomCode: created.data.roomCode, playerId: joined.data.playerId });
    assert.equal(guestChat.data.room.chatMessages[0].text, '<b>Hold formation</b>', 'authorized room members receive the same safely renderable plain text');
    assert.equal(guestChat.data.room.chatMessages[0].isMe, false);
    assert.equal((await call('get_state', { roomCode: isolatedRoom.data.roomCode, playerId: joined.data.playerId })).status, 403);

    for (let index = 2; index <= 5; index++) {
      assert.equal((await call('send_chat', { ...chatPayload, actionId: `chat-message-000${index}`, text: `message ${index}` })).status, 200);
    }
    assert.equal((await call('send_chat', { ...chatPayload, actionId: 'chat-message-0006', text: 'rate limited' })).status, 429);
    const chatRoom = store.rooms.get(created.data.roomCode);
    chatRoom.data.chatMessages = Array.from({ length: 105 }, (_, index) => ({ id: `history-${index}`, sender: 'Crew', senderId: created.data.playerId, text: `m${index}`, timestamp: now }));
    store.rooms.set(created.data.roomCode, chatRoom);
    assert.equal((await call('get_state', { roomCode: created.data.roomCode, playerId: joined.data.playerId })).data.room.chatMessages.length, 100);

    const noMember = await call('get_state', { roomCode: created.data.roomCode, playerId: 'p_aaaaaaaa' });
    assert.equal(noMember.status, 403);

    const sixRoom = await call('create_room', { nickname: 'SixHost' });
    const sixJoinIds = [];
    for (let index = 1; index < 6; index++) {
      const joinedPlayer = await call('join_room', { roomCode: sixRoom.data.roomCode, nickname: `SixCrew${index}` });
      assert.equal(joinedPlayer.status, 200);
      sixJoinIds.push(joinedPlayer.data.playerId);
    }
    const transferredHostId = sixJoinIds[2];
    const sixLobby = store.rooms.get(sixRoom.data.roomCode);
    sixLobby.data.hostId = transferredHostId;
    store.rooms.set(sixRoom.data.roomCode, sixLobby);
    const sixStarted = await call('start_game', { roomCode: sixRoom.data.roomCode, playerId: transferredHostId, testMode: true });
    assert.equal(sixStarted.status, 200);
    assert.deepEqual(sixStarted.data.room.players.map(player => player.roles), [
      ['engineer'], ['navigator'], ['gunner'], ['pilot'], ['power_operator'], ['communications_officer']
    ]);
    const sixPlayers = [sixRoom.data.playerId, ...sixJoinIds];
    const powerPlayerId = sixPlayers[4];
    const commsPlayerId = sixPlayers[5];
    const powerUpdate = await call('player_action', {
      roomCode: sixRoom.data.roomCode, playerId: powerPlayerId, matchId: sixStarted.data.room.matchId,
      actionId: 'power-allocation-01', abilityId: 'allocate_power',
      targetSystem: JSON.stringify({ engines: 50, shields: 30, weapons: 20 })
    });
    assert.equal(powerUpdate.status, 200);
    assert.deepEqual(powerUpdate.data.room.round.power.allocations, { engines: 50, shields: 30, weapons: 20 });
    const rejectedAllocation = await call('player_action', {
      roomCode: sixRoom.data.roomCode, playerId: powerPlayerId, matchId: sixStarted.data.room.matchId,
      actionId: 'power-allocation-02', abilityId: 'allocate_power',
      targetSystem: JSON.stringify({ engines: 50, shields: 30, weapons: 30 })
    });
    assert.equal(rejectedAllocation.status, 400, 'power shares outside the 100-unit budget are rejected');
    const unauthorizedPower = await call('player_action', {
      roomCode: sixRoom.data.roomCode, playerId: transferredHostId, matchId: sixStarted.data.room.matchId,
      actionId: 'power-unauthorized-01', abilityId: 'allocate_power',
      targetSystem: JSON.stringify({ engines: 50, shields: 30, weapons: 20 })
    });
    assert.equal(unauthorizedPower.status, 403);
    const boost = await call('player_action', {
      roomCode: sixRoom.data.roomCode, playerId: powerPlayerId, matchId: sixStarted.data.room.matchId,
      actionId: 'power-boost-0001', abilityId: 'boost_engines'
    });
    assert.equal(boost.status, 200);
    assert.equal(boost.data.room.round.power.energy, 70);
    assert.ok(boost.data.room.round.activeBuffs.some(buff => buff.id === 'engine_overdrive'));

    const task = sixStarted.data.room.round.communicationTask;
    assert.ok(task && task.options.length === 4);
    assert.equal(Object.hasOwn(task, 'answerIndex'), false, 'the correct communications answer is not exposed in the public snapshot');
    const storedSignal = store.rooms.get(sixRoom.data.roomCode).data.round.communicationTask;
    const wrongIndex = String((Number(storedSignal.answerIndex) + 1) % 4);
    const wrongSignal = await call('player_action', {
      roomCode: sixRoom.data.roomCode, playerId: commsPlayerId, matchId: sixStarted.data.room.matchId,
      actionId: 'comms-wrong-answer-01', abilityId: 'decode_signal', targetSystem: wrongIndex
    });
    assert.equal(wrongSignal.status, 400);
    assert.equal(store.rooms.get(sixRoom.data.roomCode).data.round.communicationScore || 0, 0);
    const correctSignalPayload = {
      roomCode: sixRoom.data.roomCode, playerId: commsPlayerId, matchId: sixStarted.data.room.matchId,
      actionId: 'comms-correct-answer-1', abilityId: 'decode_signal', targetSystem: storedSignal.answerIndex
    };
    const correctSignal = await call('player_action', correctSignalPayload);
    assert.equal(correctSignal.status, 200);
    assert.equal(correctSignal.data.room.round.communicationTask.completedAt, now);
    assert.equal(correctSignal.data.room.round.communicationScore, 100);
    const repeatedSignal = await call('player_action', correctSignalPayload);
    assert.equal(repeatedSignal.status, 200);
    assert.equal(repeatedSignal.data.duplicate, true);
    assert.equal(store.rooms.get(sixRoom.data.roomCode).data.round.communicationScore, 100);
    const expiringRoom = store.rooms.get(sixRoom.data.roomCode);
    expiringRoom.data.round.communicationTask.completedAt = null;
    expiringRoom.data.round.communicationTask.expiresAt = now - 1;
    store.rooms.set(sixRoom.data.roomCode, expiringRoom);
    const expiredSignalState = await call('get_state', { roomCode: sixRoom.data.roomCode, playerId: commsPlayerId });
    assert.ok(expiredSignalState.data.room.round.communicationTask.expiredAt,
      'the server marks an unanswered signal expired at its deadline');
    const lateSignal = await call('player_action', {
      ...correctSignalPayload, actionId: 'comms-late-answer-01'
    });
    assert.equal(lateSignal.status, 400, 'an expired signal cannot be completed');

    const started = await call('start_game', {
      roomCode: created.data.roomCode, playerId: created.data.playerId, testMode: true
    });
    assert.equal(started.status, 200);
    const firstMatchId = started.data.room.matchId;
    assert.equal(started.data.room.canControlShip, true);
    assert.equal(started.data.room.round.flight.asteroids.length, 8);
    const guestInitialFlight = await call('get_state', { roomCode: created.data.roomCode, playerId: joined.data.playerId });
    const hostInitialFlight = await call('get_state', { roomCode: created.data.roomCode, playerId: created.data.playerId });
    assert.equal(hostInitialFlight.data.room.players.find(player => player.isMe).roles.includes('pilot'), true);
    assert.equal(guestInitialFlight.data.room.players.find(player => player.isMe).roles.includes('navigator'), true);
    assert.deepEqual(hostInitialFlight.data.room.round.flight.ship, guestInitialFlight.data.room.round.flight.ship,
      'Pilot host and Navigator guest receive the exact same shared ship state');
    assert.deepEqual(hostInitialFlight.data.room.round.flight.asteroids, guestInitialFlight.data.room.round.flight.asteroids,
      'Pilot host and Navigator guest receive the exact same authoritative asteroid set');

    const coursePayload = {
      roomCode: created.data.roomCode,
      playerId: created.data.playerId,
      matchId: firstMatchId,
      actionId: 'handler-course-0001',
      inputX: 0,
      inputY: -1,
      inputSequence: 100
    };
    const course = await call('set_course', coursePayload);
    assert.equal(course.status, 200);
    assert.equal(course.data.room.round.flight.ship.inputY, -1);
    assert.equal(course.data.room.round.flight.inputSequence, 100);
    assert.equal(store.rooms.get(created.data.roomCode).data.round.contributions.pilotManeuvers, 1);
    const courseEvents = store.rooms.get(created.data.roomCode).data.round.crewEvents.filter(event => event.type === 'pilot');
    assert.equal(courseEvents.length, 1);
    assert.equal(courseEvents[0].id, `pilot:${firstMatchId}:${coursePayload.actionId}`);
    assert.equal((await call('set_course', coursePayload)).data.duplicate, true);
    assert.equal(store.rooms.get(created.data.roomCode).data.round.crewEvents.filter(event => event.type === 'pilot').length, 1,
      'replaying a course action does not append duplicate activity');
    const staleCourse = await call('set_course', { ...coursePayload, actionId: 'handler-course-stale01', inputY: 1, inputSequence: 99 });
    assert.equal(staleCourse.data.duplicate, true);
    assert.equal(staleCourse.data.room.round.flight.ship.inputY, -1);
    assert.equal((await call('set_course', { ...coursePayload, actionId: 'handler-guest-course-01', playerId: joined.data.playerId, inputSequence: 101 })).status, 403);
    assert.equal((await call('set_course', { ...coursePayload, actionId: 'handler-bad-course-01', inputX: 2, inputSequence: 102 })).status, 400);
    const polledCourse = await call('get_state', {
      roomCode: created.data.roomCode,
      playerId: created.data.playerId,
      flightInput: { x: 0, y: -1, sequence: 102 }
    });
    assert.equal(polledCourse.status, 200);
    assert.equal(polledCourse.data.room.round.flight.ship.inputY, -1);
    assert.equal((await call('set_course', { ...coursePayload, actionId: 'handler-old-course-01', matchId: '00000000-0000-0000-0000-000000000000', inputSequence: 103 })).status, 409);
    const guestControlAttempt = await call('get_state', {
      roomCode: created.data.roomCode,
      playerId: joined.data.playerId,
      flightInput: { x: 1, y: 0, sequence: 103 }
    });
    assert.equal(guestControlAttempt.status, 403);

    const mockEntry = store.rooms.get(created.data.roomCode);
    mockEntry.data.round.flight.asteroids = [{
      id: 'rock_api_collision', shapeSeed: 1, x: 0.54, y: 0.52,
      vx: 0, vy: 0, radius: 0.02, rotation: 0, spin: 0
    }];
    Object.assign(mockEntry.data.round.flight.ship, { x: 0.43, y: 0.52, heading: 0, speed: 0.245, inputX: 0, inputY: -1, vx: 0.245, vy: 0 });
    mockEntry.data.round.flight.lastTickAt = now;
    mockEntry.data.round.flight.inputUpdatedAt = now;
    store.rooms.set(created.data.roomCode, mockEntry);
    now += 600;
    const collisionSeenByGuest = await call('get_state', { roomCode: created.data.roomCode, playerId: joined.data.playerId });
    assert.equal(collisionSeenByGuest.data.room.round.hullIntegrity, 92,
      'the default 33% shield allocation reduces the nine-point collision by one');
    assert.equal(collisionSeenByGuest.data.room.round.flight.collisionEvents.length, 1);
    assert.equal(collisionSeenByGuest.data.room.round.crewEvents.filter(event => event.type === 'collision').length, 1);
    assert.equal(collisionSeenByGuest.data.room.round.lastAction.abilityId, 'flight_event');
    assert.ok(collisionSeenByGuest.data.room.round.lastAction.eventId,
      'impact notifications have a stable event identity');
    const collisionSeenByHost = await call('get_state', { roomCode: created.data.roomCode, playerId: created.data.playerId });
    assert.equal(collisionSeenByHost.data.room.round.hullIntegrity, 92);
    assert.equal(collisionSeenByHost.data.room.round.flight.collisionEvents[0].id, collisionSeenByGuest.data.room.round.flight.collisionEvents[0].id);
    assert.equal(collisionSeenByHost.data.room.round.crewEvents.filter(event => event.type === 'collision').length, 1,
      'repeated client polls do not duplicate a logical impact activity event');

    const actionPayload = {
      roomCode: created.data.roomCode,
      playerId: created.data.playerId,
      matchId: firstMatchId,
      actionId: 'handler-action-0001',
      abilityId: 'patch_hull'
    };
    assert.equal((await call('player_action', actionPayload)).status, 200);
    const replay = await call('player_action', actionPayload);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.duplicate, true);

    now += 1001;
    const late = await call('player_action', { ...actionPayload, actionId: 'handler-late-00001' });
    assert.equal(late.status, 400);
    const results = await call('get_state', { roomCode: created.data.roomCode, playerId: joined.data.playerId });
    assert.equal(results.data.room.phase, 'results');
    assert.ok(['win', 'lose'].includes(results.data.room.results.outcome));
    assert.equal(Object.values(results.data.room.results.scoreBreakdown).reduce((sum, points) => sum + points, 0),
      results.data.room.results.finalScore, 'server score breakdown sums exactly to the final score');
    assert.equal(results.data.room.results.roundDurationSeconds, 1, 'test result reports the actual round duration');
    assert.equal(results.data.room.results.roleContributions.engineer.hullRestored, 8,
      'repair amount reflects the eight hull lost after default shield allocation');
    assert.ok(store.rooms.get(created.data.roomCode).data.round.crewEvents.some(event => event.type === 'collision'));
    const previousMatchRevision = results.data.room.updatedAt;

    const reconnectAfterNetworkDrop = await call('get_state', { roomCode: created.data.roomCode, playerId: joined.data.playerId });
    assert.equal(reconnectAfterNetworkDrop.status, 200);
    const rematch = await call('request_rematch', { roomCode: created.data.roomCode, playerId: created.data.playerId, testMode: true });
    assert.equal(rematch.status, 200);
    assert.notEqual(rematch.data.room.matchId, firstMatchId);
    assert.equal(rematch.data.room.round.flight.ship.x, 0.43);
    assert.equal(rematch.data.room.round.flight.inputSequence, 0);
    assert.ok(rematch.data.room.round.updatedAt > previousMatchRevision,
      'rematch revision orders every delayed response from the completed match behind it');
    const staleMatch = await call('player_action', { ...actionPayload, actionId: 'handler-stale-00001' });
    assert.equal(staleMatch.status, 409);

    const coopRoom = await call('create_room', { nickname: 'CoopEngineer' });
    const coopNavigator = await call('join_room', { roomCode: coopRoom.data.roomCode, nickname: 'CoopNavigator' });
    const coopStart = await call('start_game', { roomCode: coopRoom.data.roomCode, playerId: coopRoom.data.playerId });
    assert.deepEqual(coopStart.data.room.players.find(player => player.isMe).roles, ['pilot', 'engineer']);
    const coopEntry = store.rooms.get(coopRoom.data.roomCode);
    coopEntry.data.round.duration = 90_000;
    coopEntry.data.round.mission = createMissionState(90_000);
    coopEntry.data.round.hullIntegrity = 70;
    coopEntry.data.round.activeEmergencies = [{
      id: 'em_coop_rogue', typeId: 'rogue_asteroid', severity: 1,
      spawnedAt: now - 1000, expiresAt: now + 11_000, resolvedAt: null
    }];
    coopEntry.data.round.flight.asteroids = [{
      id: 'rock_coop_marked', threatId: 'em_coop_rogue', shapeSeed: 71,
      x: .72, y: .52, vx: -.11, vy: 0, radius: .03, rotation: 0, spin: 0
    }];
    store.rooms.set(coopRoom.data.roomCode, coopEntry);

    const markPayload = {
      roomCode: coopRoom.data.roomCode,
      playerId: coopNavigator.data.playerId,
      matchId: coopStart.data.room.matchId,
      actionId: 'coop-mark-threat-0001',
      asteroidId: 'rock_coop_marked'
    };
    const unauthorizedMark = await call('mark_threat', { ...markPayload, playerId: coopRoom.data.playerId, actionId: 'coop-mark-denied-01' });
    assert.equal(unauthorizedMark.status, 403, 'only the Navigator may mark a real asteroid');
    const markedThreat = await call('mark_threat', markPayload);
    assert.equal(markedThreat.status, 200);
    assert.equal(markedThreat.data.room.round.flight.markedThreat.asteroidId, 'rock_coop_marked');
    assert.ok(markedThreat.data.room.round.flight.markedThreat.expiresAt > now);
    assert.equal(markedThreat.data.room.round.flight.threatRadar.targets.find(target => target.asteroidId === 'rock_coop_marked').marked, true);
    assert.equal(markedThreat.data.room.round.mission.crewMembersContributed, 0,
      'marking a threat alone does not count as a crew ability contribution');
    const repeatedMark = await call('mark_threat', markPayload);
    assert.equal(repeatedMark.data.duplicate, true, 'replayed mark request does not count twice');
    assert.equal(store.rooms.get(coopRoom.data.roomCode).data.round.contributions.navigatorMarks, 1);
    assert.equal((await call('mark_threat', { ...markPayload, asteroidId: 'rock_missing_0001', actionId: 'coop-mark-missing-1' })).status, 404,
      'Navigator cannot create a radar contact for a nonexistent asteroid');
    assert.equal((await call('mark_threat', { ...markPayload, actionId: 'coop-mark-oldmatch-1', matchId: '00000000-0000-0000-0000-000000000000' })).status, 409);
    assert.equal((await call('mark_threat', { ...markPayload, actionId: 'coop-mark-cooldown-1' })).status, 400,
      'independent repeated mark requests observe the server cooldown');
    const hostRadar = (await call('get_state', { roomCode: coopRoom.data.roomCode, playerId: coopRoom.data.playerId })).data.room.round.flight.threatRadar;
    const navigatorRadar = (await call('get_state', { roomCode: coopRoom.data.roomCode, playerId: coopNavigator.data.playerId })).data.room.round.flight.threatRadar;
    assert.deepEqual(hostRadar, navigatorRadar, 'both crew members see the same actual threat radar and marker');

    const navigatorEvade = await call('player_action', {
      roomCode: coopRoom.data.roomCode, playerId: coopNavigator.data.playerId,
      matchId: coopStart.data.room.matchId, actionId: 'coop-evade-000001', abilityId: 'evade'
    });
    assert.equal(navigatorEvade.status, 200);
    assert.equal(navigatorEvade.data.room.round.flight.navigationEvents.length, 1,
      'Navigator evasion removes the tagged real asteroid from the active path');
    assert.match(navigatorEvade.data.room.round.lastAction.message, /diverted the marked asteroid/);
    assert.equal(navigatorEvade.data.room.round.mission.emergenciesResolved, 1);
    assert.equal(navigatorEvade.data.room.round.mission.crewMembersContributed, 1);

    const engineerRepair = await call('player_action', {
      roomCode: coopRoom.data.roomCode, playerId: coopRoom.data.playerId,
      matchId: coopStart.data.room.matchId, actionId: 'coop-repair-00001', abilityId: 'patch_hull'
    });
    assert.equal(engineerRepair.status, 200);
    assert.equal(engineerRepair.data.room.round.hullIntegrity, 85);
    assert.equal(engineerRepair.data.room.round.mission.crewMembersContributed, 2,
      'Navigator evasion and Engineer repair count as two distinct crew actions');
    assert.equal(engineerRepair.data.room.round.contributions.navigatorDiversions, 1);
    assert.equal(engineerRepair.data.room.round.contributions.engineerHullRestored, 15);
    const hostMission = (await call('get_state', {
      roomCode: coopRoom.data.roomCode, playerId: coopRoom.data.playerId
    })).data.room.round.mission;
    const guestMission = (await call('get_state', {
      roomCode: coopRoom.data.roomCode, playerId: coopNavigator.data.playerId
    })).data.room.round.mission;
    assert.deepEqual(hostMission, guestMission, 'both players receive identical objective progress and threat state');
    const hostCrewEvents = (await call('get_state', {
      roomCode: coopRoom.data.roomCode, playerId: coopRoom.data.playerId
    })).data.room.round.crewEvents;
    const guestCrewEvents = (await call('get_state', {
      roomCode: coopRoom.data.roomCode, playerId: coopNavigator.data.playerId
    })).data.room.round.crewEvents;
    assert.deepEqual(hostCrewEvents, guestCrewEvents, 'both players see the same bounded event feed');
    assert.ok(hostCrewEvents.some(event => event.type === 'navigator_mark'));
    assert.ok(hostCrewEvents.some(event => event.type === 'evade'));
    assert.ok(hostCrewEvents.some(event => event.type === 'patch_hull'));
    assert.equal((await call('player_action', {
      roomCode: coopRoom.data.roomCode, playerId: coopNavigator.data.playerId,
      matchId: coopStart.data.room.matchId, actionId: 'coop-forbidden-repair', abilityId: 'patch_hull'
    })).status, 403, 'Navigator cannot invoke the Engineer-only repair');

    coopEntry.data.round.repairCooldowns[`${coopRoom.data.playerId}__patch_hull`] = now - 1;
    coopEntry.data.round.hullIntegrity = 100;
    store.rooms.set(coopRoom.data.roomCode, coopEntry);
    const unnecessaryRepair = await call('player_action', {
      roomCode: coopRoom.data.roomCode, playerId: coopRoom.data.playerId,
      matchId: coopStart.data.room.matchId, actionId: 'coop-unneeded-repair', abilityId: 'patch_hull'
    });
    assert.equal(unnecessaryRepair.status, 400, 'Engineer cannot use a repair when the hull is full');
    assert.equal(store.rooms.get(coopRoom.data.roomCode).data.round.hullIntegrity, 100,
      'unnecessary repair cannot change hull or mission progress');

    const gunnerEntry = store.rooms.get(coopRoom.data.roomCode);
    const gunnerRecord = gunnerEntry.data.players.find(player => player.id === coopNavigator.data.playerId);
    gunnerRecord.role = 'gunner';
    const gunnerRound = gunnerEntry.data.round;
    gunnerRound.duration = 90_000;
    gunnerRound.startedAt = now;
    gunnerRound.lastTickAt = now;
    gunnerRound.emergenciesResolved = 3;
    gunnerRound.mission = createMissionState(90_000);
    gunnerRound.mission.crewMemberIds = [coopRoom.data.playerId, coopNavigator.data.playerId];
    gunnerRound.activeEmergencies = [];
    gunnerRound.schedule = [];
    gunnerRound.flight.lastTickAt = now;
    gunnerRound.flight.asteroids = [
      { id: 'rock_cannon_target', shapeSeed: 72, x: .6, y: .5, vx: 0, vy: 0,
        radius: .03, rotation: 0, spin: 0, health: 7, maxHealth: 7, damageMarks: [] },
      { id: 'rock_cannon_other', shapeSeed: 84, x: .76, y: .5, vx: 0, vy: 0,
        radius: .03, rotation: 0, spin: 0, health: 5, maxHealth: 5, damageMarks: [] },
      { id: 'rock_cannon_far', shapeSeed: 96, x: .98, y: .95, vx: 0, vy: 0,
        radius: .03, rotation: 0, spin: 0, health: 3, maxHealth: 3, damageMarks: [] }
    ];
    Object.assign(gunnerRound.flight.ship, { x: .4, y: .5, heading: 0, speed: 0, vx: 0, vy: 0, inputX: 0, inputY: 0 });
    store.rooms.set(coopRoom.data.roomCode, gunnerEntry);
    const cannonPayload = {
      roomCode: coopRoom.data.roomCode, playerId: coopNavigator.data.playerId,
      matchId: coopStart.data.room.matchId, actionId: 'cannon-shot-0001',
      abilityId: 'pulse_cannon', targetAsteroidId: 'rock_cannon_target'
    };
    assert.equal((await call('player_action', { ...cannonPayload, playerId: coopRoom.data.playerId, actionId: 'cannon-denied-001' })).status, 403,
      'only the Gunner can fire the pulse cannon');
    assert.equal((await call('player_action', { ...cannonPayload, targetAsteroidId: 'rock_missing' })).status, 400,
      'a projectile cannot damage a nonexistent asteroid');
    const outOfRangeShot = await call('player_action', { ...cannonPayload, actionId: 'cannon-range-0001', targetAsteroidId: 'rock_cannon_far' });
    assert.equal(outOfRangeShot.status, 400, 'the server rejects a selected asteroid outside weapon range');
    const shotOne = await call('player_action', cannonPayload);
    assert.equal(shotOne.status, 200);
    assert.equal(shotOne.data.room.round.flight.asteroids.some(rock => rock.id === 'rock_cannon_target'), true,
      'an accepted FIRE request leaves the target asteroid alive while the projectile travels');
    assert.equal(shotOne.data.room.round.flight.projectiles.length, 1, 'accepted FIRE creates an authoritative projectile');
    assert.equal(Object.hasOwn(shotOne.data.room.round.flight.projectiles[0], 'shooterId'), false,
      "public projectile snapshots do not expose the shooter's private session ID");
    assert.equal(shotOne.data.room.round.flight.weaponEvents[0].destroyed, false, 'launch is not represented as impact');
    assert.equal(shotOne.data.room.round.score, 0, 'score is not awarded when FIRE is merely accepted');
    assert.equal(shotOne.data.room.round.flight.asteroids.some(rock => rock.id === 'rock_cannon_other'), true,
      'other original asteroids remain in the active shared field');
    const replayedLaunch = await call('player_action', cannonPayload);
    assert.equal(replayedLaunch.data.duplicate, true);
    assert.equal(replayedLaunch.data.room.round.flight.projectiles.length, 1,
      'replaying the accepted shot cannot create a duplicate projectile');
    const immediateSecondShot = await call('player_action', { ...cannonPayload, actionId: 'cannon-cooldown-1', targetAsteroidId: 'rock_cannon_other' });
    assert.equal(immediateSecondShot.status, 400, 'a separate shot still obeys the authoritative cooldown');
    assert.equal(store.rooms.get(coopRoom.data.roomCode).data.round.score, 0,
      'cooldown rejection cannot award a destruction score');
    now += 80;
    const midFlight = await call('get_state', { roomCode: coopRoom.data.roomCode, playerId: coopNavigator.data.playerId });
    assert.equal(midFlight.data.room.round.flight.asteroids.some(rock => rock.id === 'rock_cannon_target'), true,
      'the target remains alive in a later authoritative snapshot during projectile travel');
    assert.equal(midFlight.data.room.round.flight.projectiles.length, 1, 'the travelling projectile is synchronized to the firing client');
    assert.equal(midFlight.data.room.round.score, 0, 'score remains unchanged before confirmed collision');
    now += 80;
    const lateFlight = await call('get_state', { roomCode: coopRoom.data.roomCode, playerId: coopNavigator.data.playerId });
    assert.equal(lateFlight.data.room.round.flight.asteroids.some(rock => rock.id === 'rock_cannon_target'), true,
      'the target is still visible immediately before the projectile reaches it');
    assert.equal(lateFlight.data.room.round.score, 0, 'there is no score before the impact tick');
    now += 80;
    const impactState = await call('get_state', { roomCode: coopRoom.data.roomCode, playerId: coopNavigator.data.playerId });
    assert.equal(impactState.data.room.round.flight.asteroids.some(rock => rock.id === 'rock_cannon_target'), false,
      'the server removes the selected asteroid only after projectile collision');
    assert.equal(impactState.data.room.round.flight.projectiles.length, 1, 'impact state retains the projectile record for event synchronization');
    assert.equal(impactState.data.room.round.flight.projectiles[0].active, false);
    assert.equal(impactState.data.room.round.flight.projectiles[0].destroyed, true);
    assert.equal(impactState.data.room.round.flight.weaponEvents[0].destroyed, true, 'confirmed collision marks the shot destroyed');
    assert.ok(Number.isFinite(impactState.data.room.round.flight.weaponEvents[0].impactAt), 'collision event has authoritative impact time');
    assert.equal(impactState.data.room.round.score, 50, 'one confirmed impact awards +50 exactly once');
    assert.equal(impactState.data.room.round.flight.asteroids.some(rock => rock.id === 'rock_cannon_other'), true,
      'the other asteroid is not affected by the shot');
    const destroyedTargetRetry = await call('player_action', { ...cannonPayload, actionId: 'cannon-destroyed-retry', targetAsteroidId: 'rock_cannon_target' });
    assert.equal(destroyedTargetRetry.status, 400, 'a destroyed target cannot be shot again after cooldown');
    assert.equal(store.rooms.get(coopRoom.data.roomCode).data.round.score, 50,
      'a destroyed target cannot award duplicate score through a fresh request ID');
    assert.equal((await call('player_action', cannonPayload)).data.room.round.score, 50,
      'replay cannot score the same asteroid destruction twice');
    const observerWeaponEvents = (await call('get_state', { roomCode: coopRoom.data.roomCode, playerId: coopRoom.data.playerId }))
      .data.room.round.flight.weaponEvents;
    const observerGunnerState = (await call('get_state', { roomCode: coopRoom.data.roomCode, playerId: coopRoom.data.playerId })).data.room;
    assert.equal(observerWeaponEvents.at(-1).id, shotOne.data.room.round.flight.weaponEvents.at(-1).id,
      'the other client sees the same newest stable, match-scoped projectile event');
    assert.equal(observerGunnerState.round.flight.asteroids.some(rock => rock.id === 'rock_cannon_target'), false,
      'the other client receives the authoritative target removal');
    assert.equal(observerGunnerState.round.score, 50, 'the other client receives the one-time score');
    const completedGunnerEntry = store.rooms.get(coopRoom.data.roomCode);
    const completedGunnerRound = completedGunnerEntry.data.round;
    completedGunnerRound.startedAt = now - 90_001;
    completedGunnerRound.lastTickAt = now;
    completedGunnerRound.flight.lastTickAt = now;
    store.rooms.set(coopRoom.data.roomCode, completedGunnerEntry);
    const combatResults = await call('get_state', { roomCode: coopRoom.data.roomCode, playerId: coopRoom.data.playerId });
    assert.equal(combatResults.data.room.results.scoreBreakdown.combatScore, 50);
    assert.equal(combatResults.data.room.results.roleContributions.gunner.shots, 1);
    assert.equal(combatResults.data.room.results.roleContributions.gunner.asteroidsDestroyed, 1);

    const idleRoom = await call('create_room', { nickname: 'IdleHost' });
    const idleGuest = await call('join_room', { roomCode: idleRoom.data.roomCode, nickname: 'IdleGuest' });
    now += 11_000;
    const hostFailover = await call('get_state', { roomCode: idleRoom.data.roomCode, playerId: idleGuest.data.playerId });
    assert.equal(hostFailover.status, 200);
    assert.equal(hostFailover.data.room.isHost, true);
    assert.equal((await call('start_game', { roomCode: idleRoom.data.roomCode, playerId: idleGuest.data.playerId })).status, 400);

    const expiryRoom = await call('create_room', { nickname: 'ExpireHost' });
    const storedExpiryRoom = store.rooms.get(expiryRoom.data.roomCode).data;
    storedExpiryRoom.expiresAt = now - 1;
    store.rooms.set(expiryRoom.data.roomCode, { ...store.rooms.get(expiryRoom.data.roomCode), data: storedExpiryRoom });
    assert.equal((await call('get_state', { roomCode: expiryRoom.data.roomCode, playerId: expiryRoom.data.playerId })).status, 410);

    const leaveRoom = await call('create_room', { nickname: 'LeaveHost' });
    const leaveGuest = await call('join_room', { roomCode: leaveRoom.data.roomCode, nickname: 'RejoinMe' });
    assert.equal((await call('leave_room', { roomCode: leaveRoom.data.roomCode, playerId: leaveGuest.data.playerId })).status, 200);
    const rejoin = await call('join_room', { roomCode: leaveRoom.data.roomCode, nickname: 'RejoinMe' });
    assert.equal(rejoin.status, 200);
    assert.notEqual(rejoin.data.playerId, leaveGuest.data.playerId);

    const expiredSessionRoom = await call('create_room', { nickname: 'SessionHost' });
    now += lifecycle.SESSION_IDLE_TTL_MS;
    const expiredSession = await call('get_state', { roomCode: expiredSessionRoom.data.roomCode, playerId: expiredSessionRoom.data.playerId });
    assert.equal(expiredSession.status, 410);

    const oversized = await request('', {}, { rawBody: 'x'.repeat(16 * 1024 + 1) });
    assert.equal(oversized.statusCode, 413);
    const wrongType = await request('ping', {}, { headers: { 'content-type': 'text/plain' } });
    assert.equal(wrongType.statusCode, 415);

    const capacityRoom = await call('create_room', { nickname: 'RaceHost' });
    for (const nickname of ['Race1', 'Race2', 'Race3', 'Race4']) {
      assert.equal((await call('join_room', { roomCode: capacityRoom.data.roomCode, nickname })).status, 200);
    }
    const finalSlots = await Promise.all([
      call('join_room', { roomCode: capacityRoom.data.roomCode, nickname: 'Race5' }),
      call('join_room', { roomCode: capacityRoom.data.roomCode, nickname: 'Race6' })
    ]);
    assert.deepEqual(finalSlots.map(result => result.status).sort(), [200, 400]);

    console.log('API handler tests passed (mocked ETag store, deterministic clock; not a Netlify deployment test).');
  } finally {
    game._setStoreProviderForTests(null);
    Date.now = originalDateNow;
    if (originalDev === undefined) delete process.env.NETLIFY_DEV; else process.env.NETLIFY_DEV = originalDev;
    if (originalTestMode === undefined) delete process.env.ENABLE_TEST_MODE; else process.env.ENABLE_TEST_MODE = originalTestMode;
    if (originalTestDuration === undefined) delete process.env.TEST_ROUND_DURATION_MS; else process.env.TEST_ROUND_DURATION_MS = originalTestDuration;
  }
}

main().catch(error => {
  console.error('API handler tests failed:', error);
  process.exitCode = 1;
});
