// ════════════════════════════════════════════════════════════════════════════
// Signal Shift — Polling Engine
// Polls /.netlify/functions/game every POLL_INTERVAL_MS while in lobby/game.
// Triggers App.onStateUpdate(room) whenever new state arrives.
// ════════════════════════════════════════════════════════════════════════════

window.Poller = (function() {

  const POLL_INTERVAL_MS = 1500;

  let timer       = null;
  let roomCode    = null;
  let playerId    = null;
  let running     = false;
  let pollActive  = false; // prevent overlapping polls
  let generation  = 0;

  function start(rc, pid) {
    stop(); // clear any existing timer
    roomCode = rc;
    playerId = pid;
    generation++;
    running = true;
    _poll(); // immediate first poll
    timer = setInterval(_poll, POLL_INTERVAL_MS);
  }

  function stop() {
    generation++;
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
  }

  async function _poll() {
    if (!running || pollActive || !roomCode || !playerId) return;
    const pollGeneration = generation;
    const pollRoomCode = roomCode;
    const pollPlayerId = playerId;
    pollActive = true;
    try {
      const data = await API.getState(pollRoomCode, pollPlayerId, App.getFlightInput());
      if (running && pollGeneration === generation && data && data.room) {
        App.onStateUpdate(data.room);
      }
    } catch (e) {
      // Network issues are expected — don't break polling
      console.warn('[Poller] Poll error:', e.message);
      if (running && pollGeneration === generation) App.onPollError(e);
    } finally {
      pollActive = false;
    }
  }

  // Force an immediate extra poll (e.g. after an action)
  function poke() {
    if (!running) return;
    _poll();
  }

  return { start, stop, poke };

})();
