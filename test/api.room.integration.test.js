// Real API test: start `npm run dev` before running this script.
// Optional first argument overrides the default Netlify Dev function URL.

const assert = require('node:assert/strict');

const endpoint = process.argv[2] || 'http://localhost:8888/.netlify/functions/game';

async function waitForEndpoint(timeoutMs = 8000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(endpoint, { method: 'OPTIONS', signal: AbortSignal.timeout(1500) });
      if (response.status === 204) return;
      lastError = new Error(`OPTIONS ${endpoint} returned HTTP ${response.status}`);
      if (response.status !== 404 && response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  const error = new Error(
    `Netlify function is not ready at ${endpoint}. Start the local app with \`npm run dev\` and confirm the function route/port. Last probe: ${lastError?.message || 'no response'}`
  );
  error.cause = lastError;
  throw error;
}

async function post(action, payload = {}) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
      signal: AbortSignal.timeout(5000)
    });
    const data = await response.json();
    return { status: response.status, data };
  } catch (error) {
    error.message = `${action} request to ${endpoint} failed: ${error.message}`;
    throw error;
  }
}

const getState = (roomCode, playerId) => post('get_state', { roomCode, playerId });

async function main() {
  await waitForEndpoint();
  const created = await post('create_room', { nickname: 'IntegrationHost' });
  assert.equal(created.status, 200);
  assert.match(created.data.roomCode, /^[A-Z]{6}$/);
  assert.ok(created.data.playerId);

  const joined = await post('join_room', {
    roomCode: created.data.roomCode.toLowerCase(),
    nickname: 'IntegrationGuest'
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.data.roomCode, created.data.roomCode);
  assert.ok(joined.data.playerId);

  const state = await getState(created.data.roomCode, created.data.playerId);
  assert.equal(state.status, 200);
  assert.equal(state.data.room.players.length, 2);
  const restoredState = await getState(created.data.roomCode, created.data.playerId);
  assert.equal(restoredState.status, 200);
  assert.equal(restoredState.data.room.players.length, 2);

  const chatMessage = await post('send_chat', {
    roomCode: created.data.roomCode, playerId: created.data.playerId,
    actionId: 'integration-chat-0001', text: '<img src=x> crew check'
  });
  assert.equal(chatMessage.status, 200);
  const guestChat = await getState(created.data.roomCode, joined.data.playerId);
  assert.equal(guestChat.data.room.chatMessages[0].text, '<img src=x> crew check');
  assert.equal(guestChat.data.room.chatMessages[0].sender, 'IntegrationHost');
  assert.equal((await post('send_chat', {
    roomCode: created.data.roomCode, playerId: created.data.playerId,
    actionId: 'integration-chat-0001', text: '<img src=x> crew check'
  })).data.duplicate, true);
  const chatReply = await post('send_chat', {
    roomCode: created.data.roomCode, playerId: joined.data.playerId,
    actionId: 'integration-chat-0002', text: 'IntegrationGuest reply'
  });
  assert.equal(chatReply.status, 200);
  const hostChat = await getState(created.data.roomCode, created.data.playerId);
  assert.deepEqual(hostChat.data.room.chatMessages.slice(0, 2).map(message => [message.sender, message.text]), [
    ['IntegrationHost', '<img src=x> crew check'], ['IntegrationGuest', 'IntegrationGuest reply']
  ], 'both authorized clients receive ordered messages from the actual shared room endpoint');
  for (let index = 2; index <= 5; index++) {
    assert.equal((await post('send_chat', {
      roomCode: created.data.roomCode, playerId: created.data.playerId,
      actionId: `integration-chat-000${index}`, text: `host message ${index}`
    })).status, 200);
  }
  assert.equal((await post('send_chat', {
    roomCode: created.data.roomCode, playerId: created.data.playerId,
    actionId: 'integration-chat-0006', text: 'rate limited'
  })).status, 429, 'the real endpoint enforces five sends per player per ten seconds');

  const invalid = await post('join_room', { roomCode: 'ZZZZZZ', nickname: 'NoRoom' });
  assert.equal(invalid.status, 404);

  const invalidCode = await post('join_room', { roomCode: 'TOO-SHORT', nickname: 'NoRoom' });
  assert.equal(invalidCode.status, 400);

  const outsider = await getState(created.data.roomCode, 'p_aaaaaaaa');
  assert.equal(outsider.status, 403);

  const wrongTypeNickname = await post('create_room', { nickname: 42 });
  assert.equal(wrongTypeNickname.status, 400);

  const nonObjectBody = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'null'
  });
  assert.equal(nonObjectBody.status, 400);

  const wrongContentType = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{"action":"ping"}'
  });
  assert.equal(wrongContentType.status, 415);

  const started = await post('start_game', {
    roomCode: created.data.roomCode,
    playerId: created.data.playerId,
    testMode: true
  });
  assert.equal(started.status, 200);
  assert.equal(started.data.room.phase, 'playing');

  const guestState = await getState(created.data.roomCode, joined.data.playerId);
  assert.equal(guestState.status, 200);
  assert.equal(guestState.data.room.phase, 'playing');

  const course = await post('set_course', {
    roomCode: created.data.roomCode,
    playerId: created.data.playerId,
    matchId: started.data.room.matchId,
    actionId: 'integration-course-0001',
    inputX: 0,
    inputY: -1,
    inputSequence: 100
  });
  assert.equal(course.status, 200);
  assert.equal(course.data.room.round.flight.ship.inputY, -1);
  await new Promise(resolve => setTimeout(resolve, 450));
  const guestCannotSteer = await post('set_course', {
    roomCode: created.data.roomCode,
    playerId: joined.data.playerId,
    matchId: started.data.room.matchId,
    actionId: 'integration-guest-course-01',
    inputX: -1,
    inputY: 0,
    inputSequence: 101
  });
  assert.equal(guestCannotSteer.status, 403);
  const sharedFlight = await getState(created.data.roomCode, joined.data.playerId);
  assert.equal(sharedFlight.status, 200);
  assert.equal(sharedFlight.data.room.round.flight.ship.inputX, 0);
  assert.equal(sharedFlight.data.room.round.flight.ship.inputY, -1);
  assert.ok(sharedFlight.data.room.round.flight.ship.y < started.data.room.round.flight.ship.y,
    'host thrust advances the authoritative shared ship before the guest polls');
  assert.equal(sharedFlight.data.room.canControlShip, false);

  const action = await post('player_action', {
    roomCode: created.data.roomCode,
    playerId: created.data.playerId,
    matchId: started.data.room.matchId,
    actionId: 'integration-action-0001',
    abilityId: 'boost_shields'
  });
  assert.equal(action.status, 200);
  assert.equal(action.data.success, true);

  const duplicateAction = await post('player_action', {
    roomCode: created.data.roomCode,
    playerId: created.data.playerId,
    matchId: started.data.room.matchId,
    actionId: 'integration-action-0001',
    abilityId: 'boost_shields'
  });
  assert.equal(duplicateAction.status, 200);
  assert.equal(duplicateAction.data.duplicate, true);

  const outsiderAction = await post('player_action', {
    roomCode: created.data.roomCode,
    playerId: 'p_aaaaaaaa',
    matchId: started.data.room.matchId,
    actionId: 'outsider-action-00001',
    abilityId: 'patch_hull'
  });
  assert.equal(outsiderAction.status, 404);

  const staleMatchAction = await post('player_action', {
    roomCode: created.data.roomCode,
    playerId: created.data.playerId,
    matchId: '00000000-0000-0000-0000-000000000000',
    actionId: 'stale-action-000001',
    abilityId: 'patch_hull'
  });
  assert.equal(staleMatchAction.status, 409);

  const oldMatchId = started.data.room.matchId;
  const firstDeadline = started.data.room.round.remainingMs;
  assert.ok(firstDeadline <= 90000);
  const shortMatch = firstDeadline <= 30000;
  if (shortMatch) {
  let completed = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const current = await getState(created.data.roomCode, created.data.playerId);
    assert.equal(current.status, 200);
    if (current.data.room.phase === 'results') { completed = current.data.room; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(completed?.phase, 'results');
  assert.ok(['win', 'lose'].includes(completed.results.outcome));

  const lateAction = await post('player_action', {
    roomCode: created.data.roomCode,
    playerId: created.data.playerId,
    matchId: oldMatchId,
    actionId: 'late-action-0000001',
    abilityId: 'patch_hull'
  });
  assert.equal(lateAction.status, 400);

  const reconnectGuest = await getState(created.data.roomCode, joined.data.playerId);
  assert.equal(reconnectGuest.status, 200);
  assert.equal(reconnectGuest.data.room.phase, 'results');

  const rematch = await post('request_rematch', {
    roomCode: created.data.roomCode,
    playerId: created.data.playerId,
    testMode: true
  });
  assert.equal(rematch.status, 200);
  assert.equal(rematch.data.room.phase, 'playing');
  assert.notEqual(rematch.data.room.matchId, oldMatchId);
  assert.equal(rematch.data.room.round.hullIntegrity, 100);

  const staleOldMatchAction = await post('player_action', {
    roomCode: created.data.roomCode,
    playerId: created.data.playerId,
    matchId: oldMatchId,
    actionId: 'old-match-action-0001',
    abilityId: 'patch_hull'
  });
  assert.equal(staleOldMatchAction.status, 409);

  let rematchResults = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const current = await getState(created.data.roomCode, created.data.playerId);
    if (current.data.room.phase === 'results') { rematchResults = current.data.room; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(rematchResults?.phase, 'results');

  const leaveRoom = await post('leave_room', {
    roomCode: created.data.roomCode,
    playerId: created.data.playerId
  });
  assert.equal(leaveRoom.status, 200);
  const guestBecomesHost = await getState(created.data.roomCode, joined.data.playerId);
  assert.equal(guestBecomesHost.status, 200);
  assert.equal(guestBecomesHost.data.room.isHost, true);
  const rejoins = await post('join_room', { roomCode: created.data.roomCode, nickname: 'IntegrationHost' });
  assert.equal(rejoins.status, 400); // finished rooms accept no new members
  } else {
    console.log('Local server is using the normal 90-second round; timed results/rematch are covered by deterministic API handler tests.');
  }

  const hostLeaveRoom = await post('create_room', { nickname: 'HostLeave' });
  const successor = await post('join_room', { roomCode: hostLeaveRoom.data.roomCode, nickname: 'Successor' });
  assert.equal((await post('leave_room', { roomCode: hostLeaveRoom.data.roomCode, playerId: hostLeaveRoom.data.playerId })).status, 200);
  const promotedSuccessor = await getState(hostLeaveRoom.data.roomCode, successor.data.playerId);
  assert.equal(promotedSuccessor.data.room.isHost, true);
  const formerHostRejoin = await post('join_room', { roomCode: hostLeaveRoom.data.roomCode, nickname: 'HostLeave' });
  assert.equal(formerHostRejoin.status, 200);

  const rejoinRoom = await post('create_room', { nickname: 'RejoinHost' });
  const temporaryGuest = await post('join_room', { roomCode: rejoinRoom.data.roomCode, nickname: 'Temporary' });
  assert.equal(temporaryGuest.status, 200);
  const guestLeave = await post('leave_room', {
    roomCode: rejoinRoom.data.roomCode,
    playerId: temporaryGuest.data.playerId
  });
  assert.equal(guestLeave.status, 200);
  const guestRejoin = await post('join_room', { roomCode: rejoinRoom.data.roomCode, nickname: 'Temporary' });
  assert.equal(guestRejoin.status, 200);
  assert.notEqual(guestRejoin.data.playerId, temporaryGuest.data.playerId);

  const capacityRoom = await post('create_room', { nickname: 'CapacityHost' });
  assert.equal(capacityRoom.status, 200);
  assert.equal((await getState(capacityRoom.data.roomCode, created.data.playerId)).status, 403,
    'a session from another room cannot read this room chat snapshot');
  assert.equal((await post('send_chat', {
    roomCode: capacityRoom.data.roomCode, playerId: created.data.playerId,
    actionId: 'integration-cross-room', text: 'must be denied'
  })).status, 403, 'chat cannot be written with a session from another room');
  const capacityPlayerIds = [];
  for (const nickname of ['CapacityA', 'CapacityB', 'CapacityC', 'CapacityD']) {
    const result = await post('join_room', { roomCode: capacityRoom.data.roomCode, nickname });
    assert.equal(result.status, 200);
    capacityPlayerIds.push(result.data.playerId);
  }

  const finalSlot = await Promise.all([
    post('join_room', { roomCode: capacityRoom.data.roomCode, nickname: 'CapacityE' }),
    post('join_room', { roomCode: capacityRoom.data.roomCode, nickname: 'CapacityF' })
  ]);
  assert.deepEqual(finalSlot.map(result => result.status).sort(), [200, 400]);

  const finalState = await getState(capacityRoom.data.roomCode, capacityRoom.data.playerId);
  assert.equal(finalState.status, 200);
  assert.equal(finalState.data.room.players.length, 6);

  const rejectedSeventh = await post('join_room', { roomCode: capacityRoom.data.roomCode, nickname: 'Seventh' });
  assert.equal(rejectedSeventh.status, 400);
  const sixStart = await post('start_game', {
    roomCode: capacityRoom.data.roomCode,
    playerId: capacityRoom.data.playerId,
    testMode: true
  });
  assert.equal(sixStart.status, 200);
  const sixSessionIds = [capacityRoom.data.playerId, ...capacityPlayerIds, ...finalSlot.filter(result => result.status === 200).map(result => result.data.playerId)];
  assert.equal(new Set(sixSessionIds).size, 6);
  const sixStates = await Promise.all(sixSessionIds.map(id => getState(capacityRoom.data.roomCode, id)));
  assert.ok(sixStates.every(result => result.status === 200 && result.data.room.matchId === sixStart.data.room.matchId));
  const expectedRoles = [['pilot'], ['engineer'], ['navigator'], ['gunner'], ['power_operator'], ['communications_officer']];
  const actualRoles = sixStates[0].data.room.players.map(player => player.roles);
  assert.deepEqual(actualRoles, expectedRoles);
  const gunnerIndex = actualRoles.findIndex(roles => roles.includes('gunner'));
  const gunnerState = sixStates[gunnerIndex].data.room;
  const gunnerId = sixSessionIds[gunnerIndex];
  const target = gunnerState.round.flight.asteroids
    .map(asteroid => ({ asteroid, distance: Math.hypot(asteroid.x - gunnerState.round.flight.ship.x, asteroid.y - gunnerState.round.flight.ship.y) }))
    .filter(item => item.distance <= .62)
    .sort((a, b) => a.distance - b.distance)[0]?.asteroid;
  assert.ok(target, 'six-player match exposes a valid in-range asteroid for the Gunner');
  const hit = await post('player_action', {
    roomCode: capacityRoom.data.roomCode,
    playerId: gunnerId,
    matchId: sixStart.data.room.matchId,
    actionId: 'six-gunner-shot-0001',
    abilityId: 'pulse_cannon',
    targetAsteroidId: target.id
  });
  assert.equal(hit.status, 200);
  const observerIndex = (gunnerIndex + 1) % sixSessionIds.length;
  const observer = await getState(capacityRoom.data.roomCode, sixSessionIds[observerIndex]);
  const observedTarget = observer.data.room.round.flight.asteroids.find(asteroid => asteroid.id === target.id);
  assert.equal(observedTarget.health, target.health - 1, 'another live session sees the same authoritative asteroid damage');
  assert.equal((await post('player_action', {
    roomCode: capacityRoom.data.roomCode,
    playerId: gunnerId,
    matchId: sixStart.data.room.matchId,
    actionId: 'six-gunner-shot-0001',
    abilityId: 'pulse_cannon',
    targetAsteroidId: target.id
  })).data.duplicate, true, 'replaying the same live request does not apply another hit');
  const destroyResponse = await post('player_action', {
    roomCode: capacityRoom.data.roomCode, playerId: gunnerId,
    matchId: sixStart.data.room.matchId, actionId: 'six-gunner-shot-0002',
    abilityId: 'pulse_cannon', targetAsteroidId: target.id
  });
  assert.equal(destroyResponse.status, 400, 'the live cannon cooldown rejects an immediate second shot');
  await new Promise(resolve => setTimeout(resolve, 2200));
  const secondHit = await post('player_action', {
    roomCode: capacityRoom.data.roomCode, playerId: gunnerId,
    matchId: sixStart.data.room.matchId, actionId: 'six-gunner-shot-0002',
    abilityId: 'pulse_cannon', targetAsteroidId: target.id
  });
  assert.equal(secondHit.status, 200);
  await new Promise(resolve => setTimeout(resolve, 2200));
  const thirdHit = await post('player_action', {
    roomCode: capacityRoom.data.roomCode, playerId: gunnerId,
    matchId: sixStart.data.room.matchId, actionId: 'six-gunner-shot-0003',
    abilityId: 'pulse_cannon', targetAsteroidId: target.id
  });
  assert.equal(thirdHit.status, 200);
  const afterDestruction = await getState(capacityRoom.data.roomCode, sixSessionIds[observerIndex]);
  assert.equal(afterDestruction.data.room.round.flight.asteroids.some(asteroid => asteroid.id === target.id), false,
    'another live client sees the destroyed asteroid removed');
  assert.equal(afterDestruction.data.room.round.score, 50, 'the live match awards the destruction score exactly once');
  assert.equal((await post('player_action', {
    roomCode: capacityRoom.data.roomCode, playerId: gunnerId,
    matchId: sixStart.data.room.matchId, actionId: 'six-gunner-shot-0003',
    abilityId: 'pulse_cannon', targetAsteroidId: target.id
  })).data.duplicate, true, 'replaying the destruction request does not duplicate its score');
  assert.equal((await getState(capacityRoom.data.roomCode, sixSessionIds[observerIndex])).data.room.round.score, 50);
  const unauthorizedShot = await post('player_action', {
    roomCode: capacityRoom.data.roomCode,
    playerId: sixSessionIds[0],
    matchId: sixStart.data.room.matchId,
    actionId: 'six-unauthorized-shot',
    abilityId: 'pulse_cannon',
    targetAsteroidId: target.id
  });
  assert.equal(unauthorizedShot.status, 403);

  console.log('Real API integration passed: room lifecycle, readiness, two-way room chat/order/rate/isolation, host-controlled shared flight, six sessions/roles, Gunner cooldown/replay/damage/destruction/one-time score synchronization, seventh-player rejection, and concurrent capacity.');
}

main().catch(error => {
  console.error('Real API integration failed:', error.message, error.cause?.message ? `(cause: ${error.cause.message})` : '');
  process.exitCode = 1;
});
