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
  function showToast(message, type, duration) {
    if (!toastContainer) return;
    type     = type     || 'action';
    duration = duration || 3000;
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = message;
    toastContainer.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, duration);
  }

  // ── Lobby Screen ─────────────────────────────────────────────────────────
  function renderLobby(state) {
    const room = state.room;
    if (!room) return;

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
    const enabled = room.isHost && room.players.length >= 2;
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
  let _lastActionTs    = 0;
  let _lastAlarmTs     = 0;
  let _tickSec         = 91;
  let _rafHandle       = null;

  function initGame(state) {
    _prevHull      = 100;
    _lastActionTs  = 0;
    _lastAlarmTs   = 0;
    _tickSec       = 91;

    _hudTimerEl    = document.getElementById('hud-timer');
    _hudHullFillEl = document.getElementById('hud-hull-fill');
    _hudHullNumEl  = document.getElementById('hud-hull-num');
    _hudScoreEl    = document.getElementById('hud-score-val');

    renderGame(state);
    _startRaf();
  }

  function _startRaf() {
    if (_rafHandle) cancelAnimationFrame(_rafHandle);
    _rafHandle = requestAnimationFrame(_rafTick);
  }

  // RAF tick — only updates the timer display (smooth countdown)
  function _rafTick() {
    const room = App.state.room;
    if (!room || room.phase !== 'playing') return;
    const r = room.round;
    if (!r) return;

    // Compute remaining from server anchor
    const now       = Date.now();
    const elapsed   = now - (r._serverAnchorAt || now);
    const remaining = Math.max(0, (r._serverRemainingMs || 0) - elapsed);
    const secs      = Math.ceil(remaining / 1000);

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

    _rafHandle = requestAnimationFrame(_rafTick);
  }

  function stopRaf() {
    if (_rafHandle) { cancelAnimationFrame(_rafHandle); _rafHandle = null; }
  }

  function renderGame(state) {
    const room = state.room;
    if (!room || room.phase !== 'playing' || !room.round) return;
    const r = room.round;

    // Anchor for smooth timer
    r._serverAnchorAt    = Date.now();
    r._serverRemainingMs = r.remainingMs;

    // Hull bar
    const hull = r.hullIntegrity;
    if (_hudHullFillEl) {
      const pct = Math.max(0, Math.min(100, hull));
      _hudHullFillEl.style.width = pct + '%';
      _hudHullFillEl.className   = 'hud-hull-fill ' +
        (pct > 60 ? 'hull-high' : pct > 30 ? 'hull-medium' : 'hull-low');
    }
    if (_hudHullNumEl) _hudHullNumEl.textContent = Math.round(hull) + '%';

    // Hull damage sound
    if (hull < _prevHull - 2) Sound.damage();
    _prevHull = hull;

    // Score
    if (_hudScoreEl) _hudScoreEl.textContent = r.score || 0;

    // Buffs strip
    _renderBuffs(r.activeBuffs || []);

    // Action broadcast toast
    if (r.lastAction && r.lastAction.timestamp !== _lastActionTs) {
      _lastActionTs = r.lastAction.timestamp;
      const la = r.lastAction;
      if (!la.playerId || la.playerId !== state.playerId) { // don't toast your own actions to yourself (already felt instant)
        showToast('⚡ ' + esc(la.nickname) + ' used ' + esc(la.abilityName) + '!', 'action');
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

    // Role panel
    _renderRolePanel(room, r, state);
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

    const myRole = state.room?.players?.find(p => p.isMe)?.role || null;

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
      const roleDef = p.role ? GAME_DATA.getRoleDef(p.role) : null;
      const div     = document.createElement('div');
      div.className = 'crew-member' + (p.isMe ? ' is-me' : '');
      div.innerHTML =
        '<div class="crew-dot' + (p.connected ? '' : ' dc') + '"></div>' +
        '<div class="crew-role-icon">' + (roleDef ? roleDef.icon : '👤') + '</div>' +
        '<div class="crew-info">' +
          '<div class="crew-name">' + esc(p.nickname) + (p.isMe ? ' ★' : '') + '</div>' +
          '<div class="crew-role-name">' + (roleDef ? roleDef.name : 'Unassigned') + '</div>' +
        '</div>';
      panel.appendChild(div);
    });
  }

  function _renderRolePanel(room, round, state) {
    const me      = room.players.find(p => p.isMe);
    const roleDef = me?.role ? GAME_DATA.getRoleDef(me.role) : null;

    const iconEl  = document.getElementById('my-role-icon');
    const nameEl  = document.getElementById('my-role-name');
    const descEl  = document.getElementById('my-role-desc');
    if (iconEl) iconEl.textContent = roleDef ? roleDef.icon  : '?';
    if (nameEl) nameEl.textContent = roleDef ? roleDef.name  : 'Unknown';
    if (descEl) descEl.textContent = roleDef ? roleDef.description : '';

    const abList = document.getElementById('abilities-list');
    if (!abList || !roleDef) return;
    abList.innerHTML = '';

    roleDef.abilities.forEach(ab => {
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
        btn.onclick = function() { App.onUseAbility(ab.id); };
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
      if (subtitleEl) subtitleEl.textContent = cod ? 'The crew was lost to: ' + cod.name : 'The ship was destroyed.';
      Sound.defeat();
    }

    if (scoreEl) scoreEl.textContent = (res.finalScore || 0).toLocaleString();

    if (bdEl) {
      const remainSecs = res.outcome === 'win' ? Math.max(0, 90 - res.survivedSeconds) : 0;
      bdEl.innerHTML =
        _bdRow('Base Score',               res.outcome === 'win' ? '1,000' : '0') +
        _bdRow('Time Remaining (×10)',      res.outcome === 'win' ? remainSecs + ' × 10 = ' + (remainSecs*10) : '—') +
        _bdRow('Hull Integrity (×5)',       Math.round(res.hullIntegrity) + '% × 5 = ' + Math.round(res.hullIntegrity*5)) +
        _bdRow('Emergencies Resolved (×75)',(res.emergenciesResolved||0) + ' × 75 = ' + (res.emergenciesResolved||0)*75) +
        '<div class="score-divider"></div>' +
        _bdRow('TOTAL', (res.finalScore||0).toLocaleString());
    }

    if (rematchBtn) {
      rematchBtn.style.display = room.isHost ? '' : 'none';
      rematchBtn.disabled = false;
    }

    const backLobbyBtn = document.getElementById('btn-back-lobby');
    if (backLobbyBtn) backLobbyBtn.style.display = '';
  }

  function _bdRow(label, value) {
    return '<div class="score-row-label">' + esc(label) + '</div><div class="score-row-val">' + esc(String(value)) + '</div>';
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
      const t = Date.now() / 1000;
      stars.forEach(s => {
        const alpha = 0.4 + 0.5 * Math.abs(Math.sin(t * s.speed + s.a * 6.28));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200,230,255,' + alpha + ')';
        ctx.fill();
      });
      requestAnimationFrame(draw);
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
    renderLobby,
    initGame,
    renderGame,
    stopRaf,
    renderResults,
    initStars
  };

})();
