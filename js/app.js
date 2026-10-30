// ════════════════════════════════════════════════════════════════════════════
// Signal Shift — Application State Machine
// Owns all shared state. Wires DOM events to API calls.
// Exposes App.onStateUpdate() and App.onPollError() for the Poller to call.
// ════════════════════════════════════════════════════════════════════════════

window.App = (function() {

  // ── State ──────────────────────────────────────────────────────────────
  const state = {
    screen:   'splash', // 'splash' | 'name' | 'lobby' | 'game' | 'results'
    flow:     null,     // 'create' | 'join'
    roomCode: null,
    playerId: null,
    room:     null,
    isMuted:  false
  };
  const SESSION_STORAGE_KEY = 'signalShift.playerSession';
  let sessionGeneration = 0;
  let joinInFlight = false;
  let flightKeys = new Set();
  let flightInputSequence = Math.floor(Date.now() * 100 + Math.random() * 100);
  let lastFlightVector = { x: 0, y: 0 };
  const flightRequestQueue = [];
  let flightRequestActive = false;

  // ── Boot ───────────────────────────────────────────────────────────────
  function boot() {
    UI.initStars();
    _bindEvents();
    window.LandingCinematic?.initialize();
    UI.showScreen('splash');
    _restoreSession();
  }

  function _saveSession() {
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        roomCode: state.roomCode,
        playerId: state.playerId
      }));
    } catch (error) {
      console.warn('[App] Could not persist this tab session:', error.message);
    }
  }

  function _clearSession() {
    try { sessionStorage.removeItem(SESSION_STORAGE_KEY); } catch {}
  }

  async function _restoreSession() {
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || 'null'); } catch { saved = null; }
    if (!saved || typeof saved.roomCode !== 'string' || typeof saved.playerId !== 'string') return;

    const generation = ++sessionGeneration;
    state.roomCode = saved.roomCode;
    state.playerId = saved.playerId;
    UI.setLoading(true, 'Reconnecting to your crew…');
    try {
      const data = await API.getState(saved.roomCode, saved.playerId);
      if (generation !== sessionGeneration) return;
      state.room = data.room;
      state.flow = 'join';
      _showRoomForPhase(data.room);
      Poller.start(state.roomCode, state.playerId);
    } catch (error) {
      if (generation !== sessionGeneration) return;
      if ([403, 404, 410].includes(error.status)) {
        _clearSession();
        state.roomCode = null;
        state.playerId = null;
        UI.showToast('Your previous room or session has expired.', 'alert', 4000);
      } else {
        UI.showToast('Could not reconnect. Refresh to try again.', 'alert', 4000);
      }
    } finally {
      if (generation === sessionGeneration) UI.setLoading(false);
    }
  }

  function _showRoomForPhase(room) {
    if (room.phase === 'lobby') {
      state.screen = 'lobby';
      UI.renderLobby(state);
      UI.showScreen('lobby');
    } else if (room.phase === 'playing') {
      state.screen = 'game';
      UI.initGame(state);
      UI.showScreen('game');
      Sound.start();
    } else if (room.phase === 'results') {
      state.screen = 'results';
      UI.renderResults(state);
      UI.showScreen('results');
    }
  }

  // ── Event Binding ──────────────────────────────────────────────────────
  function _bindEvents() {

    // ── Splash ────────────────────────────────────────────────────────
    _on('btn-skip-intro', 'click', _skipIntro);
    _on('btn-create-room', 'click', () => {
      _skipIntro();
      state.flow = 'create';
      _setupNameScreen();
      UI.showScreen('name');
      Sound.click();
    });

    _on('btn-join-room', 'click', () => {
      _skipIntro();
      state.flow = 'join';
      _setupNameScreen();
      UI.showScreen('name');
      Sound.click();
    });

    // ── Name Screen ───────────────────────────────────────────────────
    _on('btn-name-submit', 'click', _submitName);
    _on('name-input', 'keydown', e => { if (e.key === 'Enter') _submitName(); });

    // ── Lobby ─────────────────────────────────────────────────────────
    _on('btn-copy-code', 'click', _copyRoomCode);
    _on('btn-start-game', 'click', _startGame);
    _on('btn-mark-threat', 'click', () => onMarkThreat(document.getElementById('btn-mark-threat')?.dataset.asteroidId));
    _on('btn-leave-lobby', 'click', _leaveToSplash);
    _on('chat-toggle', 'click', () => UI.toggleChat());
    _on('chat-close', 'click', () => UI.toggleChat(false));
    _on('chat-form', 'submit', event => { event.preventDefault(); _sendChat(); });
    _on('chat-input', 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); _sendChat(); } });
    _on('btn-name-back', 'click', () => { UI.showScreen('splash'); Sound.click(); });

    // ── Results ───────────────────────────────────────────────────────
    _on('btn-rematch', 'click', _requestRematch);
    _on('btn-back-lobby', 'click', _leaveToSplash);

    // ── Mute ──────────────────────────────────────────────────────────
    _on('btn-mute', 'click', _toggleMute);

    document.addEventListener('keydown', event => _handleFlightKey(event, true));
    document.addEventListener('keyup', event => _handleFlightKey(event, false));
    window.addEventListener('blur', () => _clearFlightKeys(true));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) _clearFlightKeys(true);
    });
  }

  function _skipIntro() {
    document.getElementById('screen-splash')?.classList.add('intro-skipped');
    window.LandingCinematic?.skip();
    const skip = document.getElementById('btn-skip-intro');
    if (skip) skip.hidden = true;
  }

  function _flightVector() {
    return FlightControls.vectorForDirections(flightKeys);
  }

  function _handleFlightKey(event, pressed) {
    const direction = FlightControls.directionForKey(event.key);
    if (!direction || state.screen !== 'game') return;
    if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    event.preventDefault();
    if (!state.room?.isHost) return;
    if (pressed && event.repeat) return;

    const before = _flightVector();
    if (pressed) flightKeys.add(direction);
    else flightKeys.delete(direction);
    const after = _flightVector();
    if (before.x !== after.x || before.y !== after.y) _queueCourse(after);
  }

  function _clearFlightKeys(sendStop) {
    const hadInput = flightKeys.size > 0;
    flightKeys.clear();
    if (sendStop && hadInput && state.screen === 'game' && state.room?.isHost) {
      _queueCourse({ x: 0, y: 0 });
    } else if (!sendStop || !hadInput) {
      lastFlightVector = { x: 0, y: 0 };
    }
  }

  function _queueCourse(vector) {
    if (!state.roomCode || !state.playerId || !state.room?.isHost || !state.room?.matchId) return;
    if (vector.x === lastFlightVector.x && vector.y === lastFlightVector.y) return;
    lastFlightVector = { x: vector.x, y: vector.y };
    flightRequestQueue.push({
      generation: sessionGeneration,
      roomCode: state.roomCode,
      playerId: state.playerId,
      matchId: state.room.matchId,
      inputX: vector.x,
      inputY: vector.y,
      inputSequence: ++flightInputSequence,
      actionId: crypto.randomUUID()
    });
    _drainCourseQueue();
  }

  async function _drainCourseQueue() {
    if (flightRequestActive) return;
    flightRequestActive = true;
    while (flightRequestQueue.length) {
      const command = flightRequestQueue.shift();
      if (command.generation !== sessionGeneration) continue;
      try {
        const data = await API.setCourse(command.roomCode, command.playerId, command.matchId,
          command.inputX, command.inputY, command.inputSequence, command.actionId);
        if (command.generation === sessionGeneration && data.room &&
            !FlightSnapshots.isOlder(state.room, data.room)) {
          state.room = data.room;
          UI.renderGame(state);
        }
      } catch (error) {
        if (command.generation === sessionGeneration) {
          UI.showToast(error.message || 'Flight input was not received.', 'alert', 2400);
        }
      }
    }
    flightRequestActive = false;
  }

  function getFlightInput() {
    if (state.screen !== 'game' || !state.room?.isHost) return null;
    const { x, y } = _flightVector();
    return { x, y, sequence: ++flightInputSequence };
  }

  function _setupNameScreen() {
    const joinRow = document.getElementById('join-code-row');
    if (joinRow) joinRow.style.display = state.flow === 'join' ? '' : 'none';

    const heading = document.getElementById('name-screen-heading');
    if (heading) heading.textContent = state.flow === 'create' ? 'Create a New Room' : 'Join a Room';

    const sub = document.getElementById('name-screen-sub');
    if (sub) sub.textContent = state.flow === 'create'
      ? 'Enter your nickname to create a room and get a shareable code.'
      : 'Enter the room code and your nickname to join the crew.';

    const input = document.getElementById('name-input');
    if (input) { input.value = ''; setTimeout(() => input.focus(), 100); }

    const codeInput = document.getElementById('join-code-input');
    if (codeInput) codeInput.value = '';

    UI.clearError('name-error');
  }

  async function _submitName() {
    if (joinInFlight) return;
    const nickname  = (document.getElementById('name-input')?.value || '').trim();
    const roomCode  = (document.getElementById('join-code-input')?.value || '').toUpperCase().trim();

    if (!nickname) { UI.showError('name-error', 'Please enter a nickname.'); Sound.error(); return; }
    if (nickname.length > 20) { UI.showError('name-error', 'Nickname must be 20 characters or fewer.'); Sound.error(); return; }
    if (state.flow === 'join' && !roomCode) { UI.showError('name-error', 'Please enter a room code.'); Sound.error(); return; }

    const generation = ++sessionGeneration;
    joinInFlight = true;
    UI.setLoading(true, state.flow === 'create' ? 'Creating Room…' : 'Joining Room…');
    try {
      let data;
      if (state.flow === 'create') {
        data = await API.createRoom(nickname);
      } else {
        data = await API.joinRoom(roomCode, nickname);
      }
      if (generation !== sessionGeneration) return;

      state.roomCode = data.roomCode;
      state.playerId = data.playerId;
      state.room     = data.room;
      _saveSession();

      Poller.start(state.roomCode, state.playerId);
      UI.renderLobby(state);
      UI.showScreen('lobby');
      Sound.join();
    } catch (e) {
      if (generation === sessionGeneration) {
        UI.showError('name-error', e.message || 'Could not connect to server.');
        Sound.error();
      }
    } finally {
      joinInFlight = false;
      if (generation === sessionGeneration) UI.setLoading(false);
    }
  }

  async function _copyRoomCode() {
    if (!state.roomCode) return;
    try {
      await navigator.clipboard.writeText(state.roomCode);
      UI.showToast('Room code copied to clipboard!', 'success', 2000);
    } catch {
      UI.showToast('Code: ' + state.roomCode, 'action', 3000);
    }
    Sound.click();
  }

  async function _startGame() {
    if (!state.roomCode || !state.playerId) return;
    const generation = sessionGeneration;
    UI.setLoading(true, 'Launching Mission…');
    try {
      const data = await API.startGame(state.roomCode, state.playerId);
      if (generation === sessionGeneration && data.room) {
        state.room = data.room;
        _transitionToGame();
      }
    } catch (e) {
      UI.showError('lobby-error', e.message || 'Could not start game.');
      Sound.error();
    } finally {
      UI.setLoading(false);
    }
  }

  async function _leaveToSplash() {
    const leaving = { roomCode: state.roomCode, playerId: state.playerId };
    const generation = sessionGeneration;
    if (leaving.roomCode && leaving.playerId) {
      try {
        await API.leaveRoom(leaving.roomCode, leaving.playerId);
      } catch (error) {
        if (generation === sessionGeneration) UI.showToast(error.message || 'Could not leave the room.', 'alert', 4000);
        return;
      }
    }
    if (generation !== sessionGeneration) return;
    sessionGeneration++;
    Poller.stop();
    UI.stopRaf();
    _clearSession();
    state.roomCode = null;
    state.playerId = null;
    state.room     = null;
    state.flow     = null;
    UI.showScreen('splash');
    Sound.click();
  }

  async function _requestRematch() {
    const generation = sessionGeneration;
    UI.setLoading(true, 'Starting Rematch…');
    try {
      const data = await API.requestRematch(state.roomCode, state.playerId);
      if (generation === sessionGeneration && data.room) {
        state.room = data.room;
        _transitionToGame();
      }
    } catch (e) {
      UI.showError('results-error', e.message || 'Could not start rematch.');
      Sound.error();
    } finally {
      UI.setLoading(false);
    }
  }

  function _toggleMute() {
    state.isMuted = !state.isMuted;
    Sound.setMuted(state.isMuted);
    const btn = document.getElementById('btn-mute');
    if (btn) btn.textContent = state.isMuted ? '🔇' : '🔊';
  }

  // ── Phase Transitions ──────────────────────────────────────────────────
  function _transitionToGame() {
    flightKeys.clear();
    lastFlightVector = { x: 0, y: 0 };
    flightRequestQueue.length = 0;
    state.screen = 'game';
    UI.initGame(state);
    UI.showScreen('game');
    Sound.start();
    Poller.start(state.roomCode, state.playerId); // ensure polling continues
  }

  function _transitionToResults() {
    _clearFlightKeys(false);
    state.screen = 'results';
    UI.stopRaf();
    UI.renderResults(state);
    UI.showScreen('results');
  }

  // ── Player Actions ─────────────────────────────────────────────────────
  async function onUseAbility(abilityId, targetEmergencyId, targetAsteroidId, targetSystem) {
    if (!state.roomCode || !state.playerId) return;
    const generation = sessionGeneration;
    const matchId = state.room?.matchId;
    if (!matchId) return;
    if (abilityId !== 'pulse_cannon') Sound.action();
    try {
      const actionId = crypto.randomUUID();
      const data = await API.useAbility(state.roomCode, state.playerId, matchId, abilityId,
        targetEmergencyId || null, actionId, targetAsteroidId || null, targetSystem || null);
      if (abilityId === 'pulse_cannon' && data.success && !data.duplicate) Sound.pulseCannon();
      if (generation === sessionGeneration && data.room &&
          !FlightSnapshots.isOlder(state.room, data.room)) {
        state.room = data.room;
        UI.renderGame(state);
        Poller.poke();
      }
    } catch (e) {
      if (generation === sessionGeneration) {
        UI.showToast(e.message || 'Action failed', 'alert', 3000);
        Sound.error();
      }
    }
  }

  async function onMarkThreat(asteroidId) {
    const player = state.room?.players?.find(candidate => candidate.isMe);
    if (!asteroidId || !(player?.roles || [player?.role]).includes('navigator') || !state.roomCode || !state.playerId || !state.room?.matchId) return;
    const button = document.getElementById('btn-mark-threat');
    if (button) button.disabled = true;
    const generation = sessionGeneration;
    try {
      const data = await API.markThreat(state.roomCode, state.playerId, state.room.matchId, asteroidId, crypto.randomUUID());
      if (generation === sessionGeneration && data.room && !FlightSnapshots.isOlder(state.room, data.room)) {
        state.room = data.room;
        UI.renderGame(state);
        Poller.poke();
      }
    } catch (error) {
      if (generation === sessionGeneration) {
        UI.showToast(error.message || 'Threat mark failed.', 'alert', 3000);
        UI.renderGame(state);
      }
    }
  }

  // Role × EmergencyType → AbilityId mapping
  // Engineer is the universal fallback (patch_hull resolves any emergency + restores hull).
  // radiation_burst (anyCanResolve) uses crew_respond for everyone except gunner/commander.
  const RESOLVE_MAP = {
    engine_fire:     { engineer: 'patch_hull',     default: 'patch_hull' },
    hull_breach:     { engineer: 'patch_hull',     default: 'patch_hull' },
    oxygen_leak:     { medic: 'stabilize', engineer: 'patch_hull', default: 'patch_hull' },
    nav_failure:     { navigator: 'evade', engineer: 'patch_hull', default: 'patch_hull' },
    rogue_asteroid:  { navigator: 'evade', gunner: 'counter_blast', engineer: 'patch_hull', default: 'patch_hull' },
    power_surge:     { systems_officer: 'reroute_power', engineer: 'patch_hull', default: 'patch_hull' },
    radiation_burst: { gunner: 'counter_blast', commander: 'priority_override', default: 'crew_respond' }
  };

  async function onResolveEmergency(emergencyId, typeId) {
    const me = state.room?.players?.find(p => p.isMe);
    if (!me?.role) return;

    const typeMap  = RESOLVE_MAP[typeId] || { default: 'crew_respond' };
    const roles = me.roles || [me.role];
    const abilityId = roles.map(role => typeMap[role]).find(Boolean) || typeMap.default;

    if (!abilityId) {
      UI.showToast('Your role cannot resolve this emergency.', 'alert');
      Sound.error();
      return;
    }

    await onUseAbility(abilityId, emergencyId);
  }

  // ── Polling Callbacks ──────────────────────────────────────────────────
  function onStateUpdate(room) {
    // Merge into app state
    if (FlightSnapshots.isOlder(state.room, room)) return;
    state.room = room;
    if (room.phase !== 'playing') _clearFlightKeys(false);
    if (!room.isHost && flightKeys.size) _clearFlightKeys(false);
    if (room.round?.flight?.inputSequence) {
      flightInputSequence = Math.max(flightInputSequence, room.round.flight.inputSequence);
    }

    const prevScreen = state.screen;

    if (room.phase === 'lobby' && state.screen === 'lobby') {
      UI.renderLobby(state);
    }
    // Phase-driven navigation
    if (room.phase === 'lobby' && state.screen !== 'lobby') {
      state.screen = 'lobby';
      UI.showScreen('lobby');
    } else if (room.phase === 'playing' && state.screen !== 'game') {
      state.screen = 'game';
      UI.initGame(state);
      UI.showScreen('game');
      Sound.start();
    } else if (room.phase === 'results' && state.screen !== 'results') {
      _transitionToResults();
      return;
    }

    // Re-render current screen
    if (state.screen === 'lobby') {
      UI.renderLobby(state);
    } else if (state.screen === 'game') {
      UI.renderGame(state);
    }
  }

  function onPollError(err) {
    // Only surface critical errors; transient network hiccups are ignored
    console.warn('[App] Poll error:', err.message);
  }

  async function _sendChat() {
    const input = document.getElementById('chat-input');
    const send = document.getElementById('chat-send');
    const text = input?.value.trim();
    if (!text || text.length > 500 || !state.roomCode || !state.playerId) return;
    if (send) send.disabled = true;
    try {
      const result = await API.sendChat(state.roomCode, state.playerId, text, crypto.randomUUID());
      if (input) input.value = '';
      UI.setChatStatus('Message delivered to your room.');
      if (result.room) onStateUpdate(result.room);
      Poller.poke();
    } catch (error) {
      UI.setChatStatus(error.message || 'Message could not be sent.');
    } finally {
      if (send) send.disabled = false;
    }
  }

  // ── Utility ───────────────────────────────────────────────────────────
  function _on(id, event, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
  }

  return {
    state,
    boot,
    onStateUpdate,
    onPollError,
    getFlightInput,
    onUseAbility,
    onMarkThreat,
    onResolveEmergency
  };

})();

// ── Start the app when DOM is ready ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', App.boot);
