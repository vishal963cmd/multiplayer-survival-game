// ════════════════════════════════════════════════════════════════════════════
// Signal Shift — UI Renderer
// Pure DOM manipulation. Reads App.state and renders the correct screen.
// No virtual DOM. Each render function does targeted diff-free updates.
// ════════════════════════════════════════════════════════════════════════════

window.UI = (function() {

  // ── Cached DOM refs ─────────────────────────────────────────────────────
  const screens = {
    splash:  document.getElementById('screen-splash'),
    name:    document.getElementById('screen-name'),
    lobby:   document.getElementById('screen-lobby'),
    game:    document.getElementById('screen-game'),
    results: document.getElementById('screen-results')
  };

  // ── Screen Switching ────────────────────────────────────────────────────
  function showScreen(name) {
    for (const [key, el] of Object.entries(screens)) {
      el.classList.toggle('active', key === name);
    }
    window.LandingCinematic?.setActive(name === 'splash');
    const chatToggle = document.getElementById('chat-toggle');
    const chatPanel = document.getElementById('room-chat');
    if (!['lobby', 'game', 'results'].includes(name)) {
      if (chatToggle) chatToggle.hidden = true;
      if (chatPanel) chatPanel.hidden = true;
      chatOpen = false;
    }
  }

  // ── Loading Overlay ─────────────────────────────────────────────────────
  function setLoading(visible, text) {
    const overlay = document.getElementById('loading-overlay');
    const textEl  = document.getElementById('loading-text');
    overlay.classList.toggle('visible', !!visible);
    if (textEl && text) textEl.textContent = text;
  }

  // ── Error Banner ─────────────────────────────────────────────────────────
  function showError(containerId, message) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.textContent = message;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 5000);
  }

  function clearError(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.classList.remove('visible');
  }

  // ── Toast Notifications ──────────────────────────────────────────────────
  const toastContainer = document.getElementById('toast-container');
  const toastEventLedger = window.EventLedger?.create(128);
  const toastById = new Map();
  let chatOpen = false;
  let chatRoomCode = null;
  const seenChatIds = new Set();
  const unreadChatIds = new Set();
  function showToast(message, type, duration, eventId) {
    if (!toastContainer) return;
    if (eventId && toastById.has(eventId)) return;
    type     = type     || 'action';
    duration = duration || 3000;
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = message;
    toastContainer.appendChild(el);
    while (toastContainer.children.length > 3) toastContainer.firstElementChild?.remove();
    const timer = setTimeout(() => {
      if (el.parentNode) el.remove();
      for (const [id, record] of toastById) if (record.el === el) toastById.delete(id);
    }, duration);
    if (eventId) toastById.set(eventId, { el, timer });
  }

  // ── Lobby Screen ─────────────────────────────────────────────────────────
  function renderLobby(state) {
    const room = state.room;
    if (!room) return;
    renderChat(room);

    // Room code
    const codeEl = document.getElementById('lobby-room-code');
    if (codeEl) codeEl.textContent = room.roomCode;

    // Player count
    const countEl = document.getElementById('lobby-player-count');
    if (countEl) countEl.textContent = room.players.length + ' / 6';

    // Player list
    const listEl = document.getElementById('lobby-player-list');
    if (listEl) {
      listEl.innerHTML = '';
      room.players.forEach(p => {
        const item = document.createElement('div');
        item.className = 'player-item' + (p.isMe ? ' is-me' : '');
        item.innerHTML =
          '<div class="player-dot' + (p.connected ? '' : ' disconnected') + '"></div>' +
          '<div class="player-name">' + esc(p.nickname) + (p.isMe ? ' <span style="font-size:10px;color:var(--text-muted)">(you)</span>' : '') + '</div>' +
          (p.isHost ? '<span class="player-badge">HOST</span>' : '');
        listEl.appendChild(item);
      });
    }

    // Start button visibility and enabled state
    const startBtn = document.getElementById('btn-start-game');
    const show    = room.isHost;
    const connectedCount = room.players.filter(p => p.connected).length;
      const enabled = room.isHost && connectedCount >= 2;
    startBtn.style.display = show ? '' : 'none';
    startBtn.disabled = !enabled;

    // Lobby status message
    const statusEl = document.getElementById('lobby-status');
    if (statusEl) {
      const connected = room.players.filter(p => p.connected).length;
      if (room.isHost) {
        statusEl.textContent = connected >= 2
          ? 'Ready to launch — start when everyone is in!'
          : 'Waiting for at least one more crew member…';
      } else {
        statusEl.textContent = 'Waiting for the host to start the mission…';
      }
    }
  }

  // ── Game Screen ──────────────────────────────────────────────────────────

  let _prevHull        = 100;
  let _hudTimerEl      = null;
  let _hudHullFillEl   = null;
  let _hudHullNumEl    = null;
  let _hudScoreEl      = null;
  let _gameCanvas      = null;
  let _flightRenderer  = null;
  let _rendererBootstrap = null;
  let _lastActionTs    = 0;
  let _lastAlarmTs     = 0;
  let _lastActionId    = null;
  let _tickSec         = 91;
  let _gameLoop        = null;

  function initGame(state) {
    _prevHull      = 100;
    const currentRound = state.room?.round;
    _lastActionTs  = currentRound?.lastAction?.timestamp || 0;
    _lastActionId  = currentRound?.lastAction?.eventId || null;
    _lastAlarmTs   = currentRound?.broadcastAlert?.revealedAt || 0;
    toastEventLedger?.reset(state.room?.matchId || null);
    toastEventLedger?.process(state.room?.matchId || null, currentRound?.flight?.collisionEvents);
    _tickSec       = 91;

    _hudTimerEl    = document.getElementById('hud-timer');
    _hudHullFillEl = document.getElementById('hud-hull-fill');
    _hudHullNumEl  = document.getElementById('hud-hull-num');
    _hudScoreEl    = document.getElementById('hud-score-val');
    _gameCanvas    = document.getElementById('game-canvas');
    _rendererBootstrap = _gameCanvas && window.RendererBootstrap
      ? window.RendererBootstrap.create(_gameCanvas, canvas => window.SpaceRenderer?.create(canvas))
      : null;
    _flightRenderer = _rendererBootstrap?.get() || null;
    GunnerConsole.bindCanvas(_gameCanvas, () => App.state, renderGame);

    if (!_gameLoop) _gameLoop = GameLoop.create(
      callback => window.requestAnimationFrame(callback),
      handle => window.cancelAnimationFrame(handle),
      _rafTick
    );
    renderGame(state);
    _startRaf();
  }

  function _startRaf() {
    _gameLoop?.start();
  }

  // RAF tick — only updates the timer display (smooth countdown)
  function _rafTick() {
    const room = App.state.room;
    if (!room || room.phase !== 'playing') return false;
    const r = room.round;
    if (!r) return false;

    // Compute remaining from server anchor
    const now       = Date.now();
    const elapsed   = now - (r._serverAnchorAt || now);
    const remaining = Math.max(0, (r._serverRemainingMs || 0) - elapsed);
    const secs      = Math.ceil(remaining / 1000);

    if (!_flightRenderer) _flightRenderer = _rendererBootstrap?.get(now) || null;
    if (_flightRenderer) {
      const selectedAsteroidId = window.GunnerConsole?.getSelectedTarget?.() || null;
      _flightRenderer.draw(r.flight, r.hullIntegrity, r.activeBuffs, now, selectedAsteroidId);
    }

    if (_hudTimerEl) {
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      _hudTimerEl.textContent = m + ':' + String(s).padStart(2, '0');
      _hudTimerEl.className = 'hud-timer' +
        (remaining < 15000 ? ' critical' : remaining < 30000 ? ' warning' : '');
    }

    // Warning ticks
    if (remaining < 30000 && secs !== _tickSec && secs > 0) {
      _tickSec = secs;
      Sound.tick();
    }

    return true;
  }

  function stopRaf() {
    _gameLoop?.stop();
  }

  function renderGame(state) {
    const room = state.room;
    if (!room || room.phase !== 'playing' || !room.round) return;
    renderChat(room);
    const r = room.round;

    const flightHint = document.getElementById('flight-control-hint');
    if (flightHint) {
      const controlHost = room.players.find(player => player.isHost);
      const heading = r.flight?.ship?.heading;
      const headingText = Number.isFinite(heading)
        ? ` · HEADING ${Math.round(((heading * 180 / Math.PI + 360) % 360))}°` : '';
      flightHint.textContent = (room.isHost
        ? 'YOU PILOT · W THRUST · S BRAKE · A / D STEER'
        : 'SHARED SHIP · ' + (controlHost?.nickname || 'HOST') + ' PILOTING · YOU: CREW & ABILITIES') + headingText;
      flightHint.classList.toggle('is-host', Boolean(room.isHost));
    }

    const mission = r.mission || {};
    const missionTitle = document.getElementById('mission-title');
    const missionObjective = document.getElementById('mission-objective');
    const missionProgress = document.getElementById('mission-progress');
    const missionThreat = document.getElementById('mission-threat');
    const missionStatus = document.getElementById('mission-status');
    if (missionTitle) missionTitle.textContent = mission.name || 'SURVIVE THE SIGNAL';
    if (missionObjective) missionObjective.textContent = mission.objective || 'Coordinate the crew to survive the asteroid corridor.';
    if (missionProgress) {
      missionProgress.textContent = mission.requiredEmergencyResolutions
        ? `Emergencies ${mission.emergenciesResolved}/${mission.requiredEmergencyResolutions} · Crew actions ${mission.crewMembersContributed}/${mission.requiredCrewMembers}`
        : `Emergencies ${r.emergenciesResolved || 0} · Outstanding ${mission.outstandingEmergencies || 0}`;
    }
    if (missionThreat) missionThreat.textContent = 'NEXT THREAT · ' + (mission.nextThreat || 'Scanning');
    if (missionStatus) missionStatus.textContent = mission.status || 'MISSION IN PROGRESS';
    _renderThreatRadar(r, state);

    // Anchor for smooth timer
    r._serverAnchorAt    = Date.now();
    r._serverRemainingMs = r.remainingMs;

    // Hull bar
    const hullDisplay = window.HullStatus.fromAuthoritative(r.hullIntegrity);
    const hull = hullDisplay.value;
    if (_hudHullFillEl && hull !== null) {
      const pct = hull;
      _hudHullFillEl.style.width = pct + '%';
      _hudHullFillEl.className   = 'hud-hull-fill ' +
        (pct > 60 ? 'hull-high' : pct > 30 ? 'hull-medium' : 'hull-low');
      _hudHullFillEl.parentElement?.setAttribute('aria-valuenow', String(Math.round(pct)));
      _hudHullFillEl.parentElement?.removeAttribute('aria-valuetext');
    } else if (_hudHullFillEl) {
      _hudHullFillEl.className = 'hud-hull-fill hull-unknown';
      _hudHullFillEl.parentElement?.removeAttribute('aria-valuenow');
      _hudHullFillEl.parentElement?.setAttribute('aria-valuetext', 'Hull status synchronizing');
    }
    if (_hudHullNumEl) _hudHullNumEl.textContent = hullDisplay.label;
    if (missionStatus && hullDisplay.missionStatus) missionStatus.textContent = hullDisplay.missionStatus;

    // Hull damage sound
    if (hull !== null && hull < _prevHull - 2) Sound.damage();
    if (hull !== null) _prevHull = hull;

    // Score
    if (_hudScoreEl) _hudScoreEl.textContent = r.score || 0;

    // Buffs strip
    _renderBuffs(r.activeBuffs || []);

    // Action broadcast toast
    const newCollisionEvents = toastEventLedger?.process(room.matchId, r.flight?.collisionEvents) || [];
    newCollisionEvents.forEach(event => {
      const message = event.blocked
        ? 'Point defense blocked an asteroid impact.'
        : `Asteroid impact — hull −${event.damage}%`;
      showToast(message, event.blocked ? 'success' : 'alert', 2800, `${room.matchId}:${event.id}`);
    });

    if (r.lastAction && (r.lastAction.eventId
      ? r.lastAction.eventId !== _lastActionId
      : r.lastAction.timestamp !== _lastActionTs) && r.lastAction.abilityId !== 'flight_event') {
      _lastActionTs = r.lastAction.timestamp;
      _lastActionId = r.lastAction.eventId || null;
      const la = r.lastAction;
      if (!la.playerId || la.playerId !== state.playerId) { // don't toast your own actions to yourself (already felt instant)
        showToast(la.message
          ? esc(la.message)
          : '⚡ ' + esc(la.nickname) + ' used ' + esc(la.abilityName) + '!', 'action');
      }
    }

    // Broadcast alert (emergency preview)
    if (r.broadcastAlert && r.broadcastAlert.revealedAt !== _lastAlarmTs) {
      _lastAlarmTs = r.broadcastAlert.revealedAt;
      showToast('📡 ' + r.broadcastAlert.icon + ' Incoming: ' + r.broadcastAlert.name + ' in ~8s', 'warning', 5000);
    }

    // Emergencies panel
    _renderEmergencies(r.activeEmergencies || [], state);

    // Crew panel
    _renderCrew(room.players);
    _renderCrewEvents(r.crewEvents);

    // Role panel
    _renderRolePanel(room, r, state);
  }

  function _renderThreatRadar(round, state) {
    const radar = round.flight?.threatRadar || { targets: [], markedThreat: null };
    const targetsEl = document.getElementById('radar-targets');
    const summary = document.getElementById('radar-summary');
    const button = document.getElementById('btn-mark-threat');
    const shipMarker = document.getElementById('radar-ship');
    const me = state.room?.players?.find(player => player.isMe);
    const targets = radar.targets || [];
    if (shipMarker && Number.isFinite(radar.ship?.heading)) {
      shipMarker.setAttribute('transform', `rotate(${radar.ship.heading * 180 / Math.PI + 90} 50 50)`);
    }
    if (targetsEl) {
      targetsEl.innerHTML = targets.map(target => {
        const x = 50 + Math.max(-.48, Math.min(.48, target.dx)) / .48 * 43;
        const y = 50 + Math.max(-.48, Math.min(.48, target.dy)) / .48 * 43;
        const riskClass = target.marked ? 'radar-target-marked' :
          target.threatLevel === 'high' ? 'radar-target-high' :
          target.threatLevel === 'watch' ? 'radar-target-watch' : 'radar-target';
        const radius = target.marked ? 3.4 : target.threatLevel === 'high' ? 2.8 : 2.2;
        return `<circle class="${riskClass}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius}"><title>${target.threatLevel} threat, range ${Math.round(target.distance * 100)}%</title></circle>`;
      }).join('');
    }

    const highest = targets.some(target => target.threatLevel === 'high') ? 'HIGH'
      : targets.some(target => target.threatLevel === 'watch') ? 'WATCH' : 'LOW';
    const nearest = targets[0];
    if (summary) {
      if (radar.markedThreat) {
        const remaining = Math.max(0, Math.ceil((radar.markedThreat.expiresAt - Date.now()) / 1000));
        summary.textContent = `MARKED BY ${radar.markedThreat.nickname} · ${remaining}s · ${nearest ? `NEAREST ${Math.round(nearest.distance * 100)}%` : 'TRACK LOST'}`;
      } else {
        summary.textContent = `${targets.length} CONTACT${targets.length === 1 ? '' : 'S'} · ${highest} · ${nearest ? `NEAREST ${Math.round(nearest.distance * 100)}%` : 'NO NEARBY ROCKS'}`;
      }
    }
    if (button) {
      const navigator = (me?.roles || [me?.role]).includes('navigator');
      const cooldownMs = round.myCooldowns?.mark_threat || 0;
      button.disabled = !navigator || !targets.length || cooldownMs > 0;
      button.textContent = !navigator ? 'NAVIGATOR ONLY'
        : cooldownMs > 0 ? `MARK AGAIN IN ${Math.ceil(cooldownMs / 1000)}s`
          : radar.markedThreat ? 'MARK ANOTHER' : 'MARK NEAREST';
      button.dataset.asteroidId = targets[0]?.asteroidId || '';
    }
  }

  function _renderCrewEvents(events) {
    const feed = document.getElementById('crew-event-feed');
    if (!feed) return;
    feed.replaceChildren();
    const recent = (events || []).slice(-5).reverse();
    if (!recent.length) {
      const empty = document.createElement('li');
      empty.className = 'crew-event-empty';
      empty.textContent = 'Crew actions will appear here.';
      feed.appendChild(empty);
      return;
    }
    recent.forEach(event => {
      const item = document.createElement('li');
      item.className = 'crew-event-item';
      const actor = document.createElement('strong');
      actor.textContent = `${event.nickname || 'Crew'} · `;
      item.append(actor, document.createTextNode(event.message || 'Action recorded.'));
      feed.appendChild(item);
    });
  }

  function _renderBuffs(buffs) {
    const strip = document.getElementById('buffs-strip');
    if (!strip) return;
    strip.innerHTML = '';
    buffs.forEach(b => {
      const chip = document.createElement('div');
      const secs = Math.ceil(b.remainingMs / 1000);
      let cls = 'buff-other';
      let label = b.id;
      if (b.id === 'boost_shields') { cls = 'buff-shields'; label = '🛡 Shields ' + secs + 's'; }
      else if (b.id === 'all_hands') { cls = 'buff-allhands'; label = '✊ All Hands ' + secs + 's'; }
      else if (b.id === 'stabilize') { cls = 'buff-stabilize'; label = '❤ Stabilize ' + secs + 's'; }
      else if (b.id === 'chart_course') { cls = 'buff-other'; label = '🗺 Course ' + secs + 's'; }
      chip.className = 'buff-chip ' + cls;
      chip.textContent = label;
      strip.appendChild(chip);
    });
  }

  function _renderEmergencies(emergencies, state) {
    const panel = document.getElementById('emergencies-list');
    if (!panel) return;

    const myRole = state.room?.players?.find(p => p.isMe)?.roles || [state.room?.players?.find(p => p.isMe)?.role].filter(Boolean);

    // Build a map of current card IDs
    const existing = {};
    panel.querySelectorAll('.emergency-card[data-em-id]').forEach(el => {
      existing[el.dataset.emId] = el;
    });

    const nowTs    = Date.now();
    const incoming = emergencies.filter(e => !e.resolvedAt);
    const justResolved = emergencies.filter(e => e.resolvedAt);

    // Show no-emergencies placeholder
    const noEm = document.getElementById('no-emergencies');
    if (noEm) noEm.style.display = incoming.length === 0 ? '' : 'none';

    // Play alarm if new unresolved emergencies appeared
    if (incoming.length > 0) {
      const newest = incoming.reduce((a, b) => (a.spawnedAt > b.spawnedAt ? a : b));
      if (nowTs - newest.spawnedAt < 2000) {
        Sound.alarm();
      }
    }

    // Render each emergency
    const rendered = new Set();
    incoming.forEach(em => {
      rendered.add(em.id);
      let card = existing[em.id];
      if (!card) {
        card = document.createElement('div');
        card.dataset.emId = em.id;
        panel.insertBefore(card, panel.firstChild);
      }

      const timeLeft   = em.timeLeftMs;
      const pct        = em.expiresAt > em.spawnedAt
        ? Math.max(0, Math.min(100, timeLeft / (em.expiresAt - em.spawnedAt) * 100))
        : 0;
      const isCritical = timeLeft < 5000;
      const canRes     = GAME_DATA.canResolve(myRole, em);

      let fillColor = '#f59e0b';
      if (pct < 30)      fillColor = '#ef4444';
      else if (pct < 60) fillColor = '#f97316';

      const resolveLabel = em.anyCanResolve ? 'Any crew' : (em.resolveRole ? em.resolveRole.replace('_', ' ') : 'Any crew');

      card.className = 'emergency-card' + (isCritical ? ' critical' : '');
      card.innerHTML =
        '<div class="em-header">' +
          '<div class="em-icon">' + em.icon + '</div>' +
          '<div class="em-info">' +
            '<div class="em-name">' + esc(em.name) + '</div>' +
            '<div class="em-desc">' + esc(em.description) + '</div>' +
          '</div>' +
          '<div class="em-severity">' + _severityDots(em.severity) + '</div>' +
        '</div>' +
        '<div class="em-time-bar"><div class="em-time-fill" style="width:' + pct + '%;background:' + fillColor + '"></div></div>' +
        '<div class="em-footer">' +
          '<div class="em-who">Needs: <strong>' + resolveLabel + '</strong></div>' +
          '<div class="em-time-label' + (isCritical ? ' danger' : '') + '">' + Math.ceil(timeLeft / 1000) + 's</div>' +
          _resolveButton(em, canRes, myRole) +
        '</div>';

      // Attach click handler to resolve button
      const resolveBtn = card.querySelector('.btn-resolve.can-resolve');
      if (resolveBtn) {
        resolveBtn.onclick = function() {
          App.onResolveEmergency(em.id, em.typeId);
        };
      }
    });

    // Show resolved cards briefly
    justResolved.forEach(em => {
      rendered.add(em.id);
      let card = existing[em.id];
      if (!card) {
        card = document.createElement('div');
        card.dataset.emId = em.id;
        panel.appendChild(card);
      }
      card.className = 'emergency-card resolved';
      card.innerHTML =
        '<div class="em-header">' +
          '<div class="em-icon">' + em.icon + '</div>' +
          '<div class="em-info">' +
            '<div class="em-name">' + esc(em.name) + '</div>' +
            '<div class="em-desc">Resolved by ' + esc(em.resolvedByNickname || 'crew') + '</div>' +
          '</div>' +
          '<span class="btn-resolve resolved-badge">✓ RESOLVED</span>' +
        '</div>';
    });

    // Remove cards that are no longer in data
    Object.keys(existing).forEach(id => {
      if (!rendered.has(id)) existing[id].remove();
    });
  }

  function _severityDots(severity) {
    let html = '';
    for (let i = 1; i <= 3; i++) {
      html += '<div class="sev-dot' + (i <= severity ? ' active' : '') + '"></div>';
    }
    return html;
  }

  function _resolveButton(em, canRes, myRole) {
    if (em.resolvedAt) return '';
    if (canRes) {
      return '<button class="btn-resolve can-resolve" data-em="' + em.id + '">RESPOND</button>';
    }
    return '<button class="btn-resolve cannot-resolve" disabled>Needs ' + (em.resolveRole || 'crew').replace('_', ' ') + '</button>';
  }

  function _renderCrew(players) {
    const panel = document.getElementById('crew-list');
    if (!panel) return;
    panel.innerHTML = '';
    players.forEach(p => {
      const roleDefs = GAME_DATA.getRoleDefs(p.roles || (p.role ? [p.role] : []));
      const roleDef = roleDefs[0] || null;
      const div     = document.createElement('div');
      div.className = 'crew-member' + (p.isMe ? ' is-me' : '');
      div.innerHTML =
        '<div class="crew-dot' + (p.connected ? '' : ' dc') + '"></div>' +
        '<div class="crew-role-icon">' + (roleDef ? roleDef.icon : '👤') + '</div>' +
        '<div class="crew-info">' +
          '<div class="crew-name">' + esc(p.nickname) + (p.isMe ? ' ★' : '') + '</div>' +
          '<div class="crew-role-name">' + (roleDefs.length ? roleDefs.map(def => esc(def.name)).join(' + ') : 'Unassigned') + '</div>' +
        '</div>';
      if (p.isHost) {
        const pilot = document.createElement('span');
        pilot.className = 'crew-pilot-badge';
        pilot.textContent = 'PILOT';
        div.appendChild(pilot);
      }
      panel.appendChild(div);
    });
  }

  function _renderRolePanel(room, round, state) {
    const me      = room.players.find(p => p.isMe);
    const roles = me?.roles || (me?.role ? [me.role] : []);
    const roleDefs = GAME_DATA.getRoleDefs(roles);
    const roleDef = roleDefs[0] || null;

    const iconEl  = document.getElementById('my-role-icon');
    const nameEl  = document.getElementById('my-role-name');
    const descEl  = document.getElementById('my-role-desc');
    if (iconEl) iconEl.textContent = roleDef ? roleDef.icon  : '?';
    if (nameEl) nameEl.textContent = roleDefs.length ? roleDefs.map(def => def.name).join(' + ') : 'Unknown';
    if (descEl) descEl.textContent = roleDefs.map(def => def.description).join(' ');

    const abList = document.getElementById('abilities-list');
    if (!abList || !roleDef) return;
    abList.innerHTML = '';

    const abilities = roleDefs.flatMap(def => def.abilities);
    const gunner = roles.includes('gunner');
    document.querySelector('.game-body')?.classList.toggle('gunner-aim', gunner);
    GunnerConsole.render({ round, roles, matchId: room.matchId, isPlaying: room.phase === 'playing' });

    const powerConsole = document.getElementById('power-console');
    const hasPowerRole = roles.includes('power_operator');
    if (powerConsole) powerConsole.hidden = !hasPowerRole;
    const power = round.power || { allocations: { engines: 34, shields: 33, weapons: 33 }, energy: 100 };
    const powerInputs = ['engines', 'shields', 'weapons'].map(key => document.getElementById(`power-${key}`));
    powerInputs.forEach((input, index) => {
      if (input && document.activeElement !== input) input.value = power.allocations?.[['engines', 'shields', 'weapons'][index]] ?? [34, 33, 33][index];
    });
    const applyPower = document.getElementById('btn-apply-power');
    const powerTotal = document.getElementById('power-total');
    const updatePowerTotal = () => {
      const values = powerInputs.map(input => Number(input?.value));
      const total = values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
      if (powerTotal) powerTotal.textContent = `TOTAL ${total} / 100 · RESERVE ${power.energy ?? 100}`;
      if (applyPower) applyPower.disabled = !hasPowerRole || total !== 100 || values.some(value => !Number.isInteger(value) || value < 0 || value > 100);
    };
    powerInputs.forEach(input => { if (input) input.oninput = updatePowerTotal; });
    updatePowerTotal();
    if (applyPower) applyPower.onclick = () => {
      const allocations = Object.fromEntries(['engines', 'shields', 'weapons'].map((key, index) => [key, Number(powerInputs[index]?.value)]));
      App.onUseAbility('allocate_power', null, null, JSON.stringify(allocations));
    };

    const commsConsole = document.getElementById('comms-console');
    const hasCommsRole = roles.includes('communications_officer');
    const task = round.communicationTask;
    if (commsConsole) commsConsole.hidden = !hasCommsRole;
    const commsStatus = document.getElementById('comms-task-status');
    const commsOptions = document.getElementById('comms-options');
    if (commsStatus) {
      if (!task) commsStatus.textContent = 'No transmission assigned.';
      else if (task.completedAt) commsStatus.textContent = 'SIGNAL CONFIRMED · +100 TEAM SCORE';
      else if (task.expiredAt || task.expiresAt <= Date.now()) commsStatus.textContent = 'SIGNAL WINDOW CLOSED';
      else commsStatus.textContent = `Repeat the three-symbol sequence before ${Math.ceil((task.expiresAt - Date.now()) / 1000)}s: ${(task.sequence || []).join(' ')}`;
    }
    if (commsOptions) {
      commsOptions.replaceChildren();
      (task?.options || []).forEach((sequence, index) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'comms-option';
        option.textContent = sequence.join(' ');
        option.setAttribute('aria-label', `Signal answer ${index + 1}: ${sequence.join(' ')}`);
        option.disabled = !hasCommsRole || !task || !!task.completedAt || !!task.expiredAt || task.expiresAt <= Date.now();
        option.onclick = () => App.onUseAbility('decode_signal', null, null, String(index));
        commsOptions.appendChild(option);
      });
    }

    abilities.filter(ability => !['pulse_cannon', 'allocate_power', 'decode_signal'].includes(ability.id)).forEach(ab => {
      const cdMs  = (round.myCooldowns || {})[ab.id] || 0;
      const ready = cdMs <= 0;
      const totalCd = ab.cooldownMs;
      const pct     = ready ? 0 : Math.min(100, (cdMs / totalCd) * 100);

      const wrap = document.createElement('div');
      wrap.className = 'ability-btn-wrap';

      const btn = document.createElement('button');
      btn.className = 'ability-btn' + (ready ? ' ready' : ' on-cooldown');
      btn.disabled  = !ready;
      btn.innerHTML =
        '<div class="abl-top">' +
          '<span class="abl-icon">' + ab.icon + '</span>' +
          '<span class="abl-name">' + esc(ab.name) + '</span>' +
        '</div>' +
        '<div class="abl-desc">' + esc(ab.description) + '</div>' +
        (ready
          ? '<div class="abl-ready-text">READY</div>'
          : '<div class="abl-cd">' + _fmtCooldown(cdMs) + '</div>'
        ) +
        '<div class="abl-cooldown-overlay" style="height:' + pct + '%"></div>';

      if (ready) {
        btn.onclick = function() {
          App.onUseAbility(ab.id, null, null);
        };
      }

      wrap.appendChild(btn);
      abList.appendChild(wrap);
    });
  }

  function _fmtCooldown(ms) {
    const s = Math.ceil(ms / 1000);
    return s + 's';
  }

  // ── Results Screen ────────────────────────────────────────────────────────
  function renderResults(state) {
    const room = state.room;
    if (!room || room.phase !== 'results' || !room.results) return;
    renderChat(room);
    const res = room.results;

    const iconEl     = document.getElementById('outcome-icon');
    const titleEl    = document.getElementById('outcome-title');
    const subtitleEl = document.getElementById('outcome-subtitle');
    const scoreEl    = document.getElementById('final-score');
    const bdEl       = document.getElementById('score-breakdown');
    const rematchBtn = document.getElementById('btn-rematch');

    if (res.outcome === 'win') {
      if (iconEl)  iconEl.textContent    = '🏆';
      if (titleEl) { titleEl.textContent = 'MISSION COMPLETE'; titleEl.className = 'outcome-title outcome-win'; }
      if (subtitleEl) subtitleEl.textContent = 'The crew survived! Outstanding teamwork.';
      Sound.victory();
    } else {
      if (iconEl)  iconEl.textContent    = '💀';
      if (titleEl) { titleEl.textContent = 'MISSION FAILED'; titleEl.className = 'outcome-title outcome-lose'; }
      const cod = res.causeOfDeath ? GAME_DATA.getEmergencyDef(res.causeOfDeath) : null;
      if (subtitleEl) subtitleEl.textContent = res.causeOfDeath === 'mission_objective_incomplete'
        ? 'The ship survived, but the crew did not meet the shared response objective.'
        : cod ? 'The crew was lost to: ' + cod.name : 'The ship was destroyed.';
      Sound.defeat();
    }

    if (scoreEl) scoreEl.textContent = (res.finalScore || 0).toLocaleString();

    if (bdEl) {
      const score = res.scoreBreakdown || {};
      const roles = res.roleContributions || {};
      const pilot = roles.pilot || {};
      const navigator = roles.navigator || {};
      const engineer = roles.engineer || {};
      const gunner = roles.gunner || {};
      const powerOperator = roles.powerOperator || {};
      const communicationsOfficer = roles.communicationsOfficer || {};
      bdEl.innerHTML =
        _bdRow('Mission completion', `${score.missionComplete ?? (res.outcome === 'win' ? 1000 : 0)} pts`) +
        _bdRow(`Survival time (${res.roundDurationSeconds || 90}s round)`, `${res.survivedSeconds || 0}s · ${score.remainingTime ?? 0} pts`) +
        _bdRow('Final hull', `${Math.round(res.hullIntegrity)}% · ${score.hullIntegrity ?? Math.round(res.hullIntegrity) * 5} pts`) +
        _bdRow('Emergencies resolved', `${res.emergenciesResolved || 0} · ${score.emergenciesResolved ?? (res.emergenciesResolved || 0) * 75} pts`) +
        _bdRow('Rapid responses', `${res.speedBonuses || 0} × 25 = ${score.rapidResponses ?? 0} pts`) +
        _bdRow('Combat score', `${score.combatScore ?? 0} pts`) +
        _bdRow('Communications score', `${score.communicationsScore ?? 0} pts`) +
        '<div class="score-divider"></div>' +
        _bdRow(`Pilot · ${pilot.nickname || '—'}`, `${pilot.maneuvers || 0} course changes`) +
        _bdRow(`Navigator · ${navigator.nickname || '—'}`, `${navigator.threatsMarked || 0} marked · ${navigator.threatsDiverted || 0} diverted`) +
        _bdRow(`Engineer · ${engineer.nickname || '—'}`, `${engineer.repairs || 0} repairs · ${Math.round(engineer.hullRestored || 0)} hull restored · ${engineer.shieldsActivated || 0} shields`) +
        _bdRow(`Gunner · ${gunner.nickname || '—'}`, `${gunner.shots || 0} pulse hits · ${gunner.asteroidsDestroyed || 0} destroyed`) +
        _bdRow(`Power Operator · ${powerOperator.nickname || '—'}`, `${powerOperator.allocations || 0} allocations · ${powerOperator.boosts || 0} engine boosts`) +
        _bdRow(`Communications · ${communicationsOfficer.nickname || '—'}`, `${communicationsOfficer.tasksCompleted || 0} signal tasks confirmed`) +
        '<div class="score-divider"></div>' +
        _bdRow('TEAM TOTAL', (res.finalScore || 0).toLocaleString());
    }

    if (rematchBtn) {
      rematchBtn.style.display = room.isHost ? '' : 'none';
      rematchBtn.disabled = false;
    }

    const backLobbyBtn = document.getElementById('btn-back-lobby');
    if (backLobbyBtn) backLobbyBtn.style.display = '';
  }

  function _bdRow(label, value) {
    return '<div class="score-row-label">' + esc(String(label)) + '</div><div class="score-row-val">' + esc(String(value)) + '</div>';
  }

  function renderChat(room) {
    const toggle = document.getElementById('chat-toggle');
    const panel = document.getElementById('room-chat');
    const list = document.getElementById('chat-messages');
    const unread = document.getElementById('chat-unread');
    if (!toggle || !panel || !list) return;
    toggle.hidden = !room || !['lobby', 'playing', 'results'].includes(room.phase);
    if (chatRoomCode !== room.roomCode) {
      chatRoomCode = room.roomCode;
      seenChatIds.clear();
      unreadChatIds.clear();
      setChatStatus('Messages are shared with this room.');
      for (const message of room.chatMessages || []) seenChatIds.add(message.id);
    }
    const messages = room.chatMessages || [];
    if (chatOpen) {
      for (const message of messages) seenChatIds.add(message.id);
      unreadChatIds.clear();
    } else {
      for (const message of messages) {
        if (!seenChatIds.has(message.id) && !message.isMe) unreadChatIds.add(message.id);
        seenChatIds.add(message.id);
      }
    }
    while (seenChatIds.size > 200) seenChatIds.delete(seenChatIds.values().next().value);
    while (unreadChatIds.size > 100) unreadChatIds.delete(unreadChatIds.values().next().value);
    unread.hidden = unreadChatIds.size === 0;
    unread.textContent = String(unreadChatIds.size);
    panel.hidden = !chatOpen;
    toggle.setAttribute('aria-expanded', String(chatOpen));
    const context = document.getElementById('chat-room-context');
    if (context) context.textContent = `Room · ${room.roomCode}`;
    const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    list.replaceChildren();
    for (const message of messages) {
      const item = document.createElement('li');
      const heading = document.createElement('strong');
      const body = document.createElement('span');
      const time = document.createElement('time');
      heading.textContent = message.isMe ? 'You' : message.sender;
      body.textContent = message.text;
      time.dateTime = new Date(message.timestamp).toISOString();
      time.textContent = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      item.append(heading, body, time);
      list.appendChild(item);
    }
    if (!messages.length) {
      const empty = document.createElement('li');
      empty.className = 'chat-empty';
      empty.textContent = 'No messages yet. Send the first signal to your crew.';
      list.appendChild(empty);
    }
    if (chatOpen && wasNearBottom) list.scrollTop = list.scrollHeight;
  }

  function toggleChat(force) {
    chatOpen = typeof force === 'boolean' ? force : !chatOpen;
    if (chatOpen) {
      for (const message of (window.App?.state?.room?.chatMessages || [])) seenChatIds.add(message.id);
      unreadChatIds.clear();
      const input = document.getElementById('chat-input');
      input?.focus();
    }
    const room = window.App?.state?.room;
    if (room) renderChat(room);
  }

  function setChatStatus(message) {
    const status = document.getElementById('chat-status');
    if (status) status.textContent = message;
  }

  // ── Starfield Canvas ──────────────────────────────────────────────────────
  function initStars() {
    const canvas = document.getElementById('stars-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let stars = [];
    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      stars = Array.from({ length: 180 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.5 + 0.3,
        a: Math.random(),
        speed: Math.random() * 0.4 + 0.1
      }));
    }
    window.addEventListener('resize', resize);
    resize();

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      stars.forEach(s => {
        const alpha = 0.25 + 0.55 * s.a;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200,230,255,' + alpha + ')';
        ctx.fill();
      });
    }
    draw();
  }

  // ── Escape HTML ───────────────────────────────────────────────────────────
  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    showScreen,
    setLoading,
    showError,
    clearError,
    showToast,
    toggleChat,
    setChatStatus,
    renderLobby,
    initGame,
    renderGame,
    stopRaf,
    renderResults,
    initStars
  };

})();
