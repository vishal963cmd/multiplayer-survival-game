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

  function start(rc, pid) {
    roomCode = rc;
    playerId = pid;
    running  = true;
    stop(); // clear any existing timer
    _poll(); // immediate first poll
    timer = setInterval(_poll, POLL_INTERVAL_MS);
  }

  function stop() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
  }

  async function _poll() {
    if (!running || pollActive || !roomCode || !playerId) return;
    pollActive = true;
    try {
      const data = await API.getState(roomCode, playerId);
      if (data && data.room) {
        App.onStateUpdate(data.room);
      }
    } catch (e) {
      // Network issues are expected — don't break polling
      console.warn('[Poller] Poll error:', e.message);
      App.onPollError(e);
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
