// ════════════════════════════════════════════════════════════════════════════
// Signal Shift — API Actions
// All server calls go through callAPI().
// Frontend NEVER constructs the full function URL except here.
// ════════════════════════════════════════════════════════════════════════════

window.API = (function() {

  const ENDPOINT = '/.netlify/functions/game';

  async function callAPI(action, payload, method) {
    method = method || 'POST';

    let res;
    if (method === 'GET') {
      const params = new URLSearchParams({ action });
      for (const [k, v] of Object.entries(payload || {})) {
        if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
      }
      res = await fetch(ENDPOINT + '?' + params.toString(), { method: 'GET' });
    } else {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(payload || {}) })
      });
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error ' + res.status);
    return data;
  }

  return {
    // ── Lobby ────────────────────────────────────────────────────────
    createRoom(nickname) {
      return callAPI('create_room', { nickname });
    },

    joinRoom(roomCode, nickname) {
      return callAPI('join_room', { roomCode, nickname });
    },

    getState(roomCode, playerId) {
      return callAPI('get_state', { roomCode, playerId }, 'GET');
    },

    startGame(roomCode, playerId) {
      return callAPI('start_game', { roomCode, playerId });
    },

    // ── Game ─────────────────────────────────────────────────────────
    useAbility(roomCode, playerId, abilityId, targetEmergencyId) {
      return callAPI('player_action', {
        roomCode,
        playerId,
        abilityId,
        targetEmergencyId: targetEmergencyId || null
      });
    },

    // ── Post-game ────────────────────────────────────────────────────
    requestRematch(roomCode, playerId) {
      return callAPI('request_rematch', { roomCode, playerId });
    },

    ping(roomCode, playerId) {
      return callAPI('ping', { roomCode, playerId });
    }
  };

})();
