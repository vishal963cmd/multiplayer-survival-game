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

    let data;
    try {
      data = await res.json();
    } catch (_) {
      data = {};
    }
    if (!res.ok) {
      const error = new Error(data.error || (res.status === 429
        ? 'Too many requests. Please wait a moment and try again.'
        : 'Server error ' + res.status));
      error.status = res.status;
      throw error;
    }
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

    getState(roomCode, playerId, flightInput) {
      return callAPI('get_state', { roomCode, playerId, ...(flightInput ? { flightInput } : {}) });
    },

    sendChat(roomCode, playerId, text, actionId) {
      return callAPI('send_chat', { roomCode, playerId, text, actionId });
    },

    startGame(roomCode, playerId) {
      return callAPI('start_game', { roomCode, playerId });
    },

    // ── Game ─────────────────────────────────────────────────────────
    useAbility(roomCode, playerId, matchId, abilityId, targetEmergencyId, actionId, targetAsteroidId, targetSystem) {
      return callAPI('player_action', {
        roomCode,
        playerId,
        matchId,
        actionId,
        abilityId,
        targetEmergencyId: targetEmergencyId || null,
        targetAsteroidId: targetAsteroidId || null,
        targetSystem: targetSystem || null
      });
    },

    setCourse(roomCode, playerId, matchId, inputX, inputY, inputSequence, actionId) {
      return callAPI('set_course', { roomCode, playerId, matchId, inputX, inputY, inputSequence, actionId });
    },

    markThreat(roomCode, playerId, matchId, asteroidId, actionId) {
      return callAPI('mark_threat', { roomCode, playerId, matchId, asteroidId, actionId });
    },

    // ── Post-game ────────────────────────────────────────────────────
    requestRematch(roomCode, playerId) {
      return callAPI('request_rematch', { roomCode, playerId });
    },

    leaveRoom(roomCode, playerId) {
      return callAPI('leave_room', { roomCode, playerId });
    },

    ping(roomCode, playerId) {
      return callAPI('ping', { roomCode, playerId });
    }
  };

})();
