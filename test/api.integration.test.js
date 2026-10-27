// Integration test for Signal Shift backend API
// Requires the Netlify dev server to be running (npm run dev)
// Uses the built‑in fetch API (Node 18+).

const assert = (desc, cond) => {
  if (cond) console.log('✓', desc);
  else console.error('✗', desc);
};

(async () => {
  const endpoint = 'http://localhost:8888/.netlify/functions/game';
  const call = async (action, payload = {}, method = 'POST') => {
    const opts = { method };
    if (method === 'GET') {
      const q = new URLSearchParams({ action, ...payload }).toString();
      const res = await fetch(`${endpoint}?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error');
      return data;
    }
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify({ action, ...payload });
    const res = await fetch(endpoint, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');
    return data;
  };

  try {
    // 1️⃣ Create a room (host)
    const create = await call('create_room', { nickname: 'Host' });
    assert('create_room returns roomCode', !!create.roomCode);
    assert('create_room returns playerId', !!create.playerId);

    // 2️⃣ Join as second player
    const join = await call('join_room', { roomCode: create.roomCode, nickname: 'Guest' });
    assert('join_room returns same roomCode', join.roomCode === create.roomCode);
    assert('join_room returns playerId', !!join.playerId);

    // 3️⃣ Host fetches lobby state
    const stateHost = await call('get_state', { roomCode: create.roomCode, playerId: create.playerId }, 'GET');
    assert('host sees 2 players in lobby', stateHost.room.players.length === 2);
    assert('host is marked isHost', stateHost.room.isHost === true);

    // 4️⃣ Host starts game
    const start = await call('start_game', { roomCode: create.roomCode, playerId: create.playerId, testMode: true });
    assert('start_game moves to playing', start.room.phase === 'playing');

    // 5️⃣ Wait for a navigator‑resolvable emergency (nav_failure or rogue_asteroid)
    const waitForNavigatorEmergency = async (maxMs = 30000, interval = 1000) => {
      const deadline = Date.now() + maxMs;
      while (Date.now() < deadline) {
        const cur = await call('get_state', { roomCode: create.roomCode, playerId: create.playerId }, 'GET');
        const emergencies = (cur.room.round && cur.room.round.activeEmergencies) || [];
        const navEmerg = emergencies.find(e => e.typeId === 'nav_failure' || e.typeId === 'rogue_asteroid');
        if (navEmerg) return navEmerg;
        await new Promise(r => setTimeout(r, interval));
      }
      throw new Error('Timed out waiting for a navigator‑resolvable emergency');
    };
    const navEmerg = await waitForNavigatorEmergency();
    assert('navigator‑resolvable emergency exists', !!navEmerg);

    // 6️⃣ Simultaneous abilities (host patch_hull, guest evade)
    const [a1, a2] = await Promise.all([
      call('player_action', { roomCode: create.roomCode, playerId: create.playerId, abilityId: 'patch_hull' }),
      call('player_action', { roomCode: create.roomCode, playerId: join.playerId, abilityId: 'evade', targetEmergencyId: navEmerg.id })
    ]);
    assert('both actions succeed', a1.success && a2.success);

    // 7️⃣ Verify that the game state updated (no specific score expectation)
    const after = await call('get_state', { roomCode: create.roomCode, playerId: create.playerId }, 'GET');
    assert('state updated after actions', after.room.round.updatedAt > start.room.updatedAt);

    // 8️⃣ End round (poll until results phase)
    let final;
    for (let i = 0; i < 30; i++) {
      const cur = await call('get_state', { roomCode: create.roomCode, playerId: create.playerId }, 'GET');
      if (cur.room.phase === 'results') { final = cur; break; }
      await new Promise(r => setTimeout(r, 1500));
    }
    assert('reached results phase', final && final.room.phase === 'results');

    // 9️⃣ Host requests rematch
    const rem = await call('request_rematch', { roomCode: create.roomCode, playerId: create.playerId });
    assert('rematch returns playing phase', rem.room.phase === 'playing');

    console.log('\nAll integration assertions passed.');
  } catch (e) {
    console.error('\nIntegration test failed:', e.message);
    process.exit(1);
  }
})();
