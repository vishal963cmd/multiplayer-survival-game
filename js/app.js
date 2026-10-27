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

  // ── Boot ───────────────────────────────────────────────────────────────
  function boot() {
    UI.initStars();
    _bindEvents();
    UI.showScreen('splash');
  }

  // ── Event Binding ──────────────────────────────────────────────────────
  function _bindEvents() {

    // ── Splash ────────────────────────────────────────────────────────
    _on('btn-create-room', 'click', () => {
      state.flow = 'create';
      _setupNameScreen();
      UI.showScreen('name');
      Sound.click();
    });

    _on('btn-join-room', 'click', () => {
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
    _on('btn-leave-lobby', 'click', _leaveToSplash);
    _on('btn-name-back', 'click', () => { UI.showScreen('splash'); Sound.click(); });

    // ── Results ───────────────────────────────────────────────────────
    _on('btn-rematch', 'click', _requestRematch);
    _on('btn-back-lobby', 'click', _leaveToSplash);

    // ── Mute ──────────────────────────────────────────────────────────
    _on('btn-mute', 'click', _toggleMute);
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
    const nickname  = (document.getElementById('name-input')?.value || '').trim();
    const roomCode  = (document.getElementById('join-code-input')?.value || '').toUpperCase().trim();

    if (!nickname) { UI.showError('name-error', 'Please enter a nickname.'); Sound.error(); return; }
    if (nickname.length > 20) { UI.showError('name-error', 'Nickname must be 20 characters or fewer.'); Sound.error(); return; }
    if (state.flow === 'join' && !roomCode) { UI.showError('name-error', 'Please enter a room code.'); Sound.error(); return; }

    UI.setLoading(true, state.flow === 'create' ? 'Creating Room…' : 'Joining Room…');
    try {
      let data;
      if (state.flow === 'create') {
        data = await API.createRoom(nickname);
      } else {
        data = await API.joinRoom(roomCode, nickname);
      }

      state.roomCode = data.roomCode;
      state.playerId = data.playerId;
      state.room     = data.room;

      Poller.start(state.roomCode, state.playerId);
      UI.renderLobby(state);
      UI.showScreen('lobby');
      Sound.join();
    } catch (e) {
      UI.showError('name-error', e.message || 'Could not connect to server.');
      Sound.error();
    } finally {
      UI.setLoading(false);
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
    UI.setLoading(true, 'Launching Mission…');
    try {
      const data = await API.startGame(state.roomCode, state.playerId);
      if (data.room) {
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

  function _leaveToSplash() {
    Poller.stop();
    UI.stopRaf();
    state.roomCode = null;
    state.playerId = null;
    state.room     = null;
    state.flow     = null;
    UI.showScreen('splash');
    Sound.click();
  }

  async function _requestRematch() {
    UI.setLoading(true, 'Starting Rematch…');
    try {
      const data = await API.requestRematch(state.roomCode, state.playerId);
      if (data.room) {
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
    state.screen = 'game';
    UI.initGame(state);
    UI.showScreen('game');
    Sound.start();
    Poller.start(state.roomCode, state.playerId); // ensure polling continues
  }

  function _transitionToResults() {
    state.screen = 'results';
    UI.stopRaf();
    UI.renderResults(state);
    UI.showScreen('results');
  }

  // ── Player Actions ─────────────────────────────────────────────────────
  async function onUseAbility(abilityId, targetEmergencyId) {
    if (!state.roomCode || !state.playerId) return;
    Sound.action();
    try {
      const data = await API.useAbility(state.roomCode, state.playerId, abilityId, targetEmergencyId || null);
      if (data.room) {
        state.room = data.room;
        UI.renderGame(state);
        Poller.poke();
      }
    } catch (e) {
      UI.showToast(e.message || 'Action failed', 'alert', 3000);
      Sound.error();
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
    const abilityId = typeMap[me.role] || typeMap.default;

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
    state.room = room;

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
    onUseAbility,
    onResolveEmergency
  };

})();

// ── Start the app when DOM is ready ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', App.boot);
