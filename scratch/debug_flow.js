const fetch = require('node-fetch');
(async () => {
  const base = 'http://localhost:8888/.netlify/functions/game';
  const create = await (await fetch(base, {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({action:'create_room', nickname:'Host'})})).json();
  const rc = create.roomCode;
  const host = create.playerId;
  const join = await (await fetch(base, {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({action:'join_room', roomCode: rc, nickname:'Guest'})})).json();
  const startResp = await fetch(base, {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({action:'start_game', roomCode: rc, playerId: host, testMode:true})});
  const start = await startResp.json();
  console.log('Start updatedAt', start.room.round.updatedAt);
  const act1 = await fetch(base, {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({action:'player_action', roomCode: rc, playerId: host, abilityId:'patch_hull'})});
  const a1 = await act1.json();
  const act2 = await fetch(base, {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({action:'player_action', roomCode: rc, playerId: join.playerId, abilityId:'evade'})});
  const a2 = await act2.json();
  const afterResp = await fetch(`${base}?action=get_state&roomCode=${rc}&playerId=${host}`, {method: 'GET'});
  const after = await afterResp.json();
  console.log('After updatedAt', after.room.round.updatedAt);
})();
