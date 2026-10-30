// Gunner's target selection and firing console. Damage remains server-authoritative.
window.GunnerConsole = (function() {
  let selectedAsteroidId = null;
  let selectedMatchId = null;
  let pendingMatchId = null;

  function bindCanvas(canvas, getState, onSelection) {
    if (!canvas || canvas.dataset.gunnerTargetInputBound) return;
    canvas.dataset.gunnerTargetInputBound = 'true';
    canvas.addEventListener('pointerdown', event => {
      const state = getState();
      const room = state?.room;
      const player = room?.players?.find(candidate => candidate.isMe);
      const roles = player?.roles || (player?.role ? [player.role] : []);
      const flight = room?.round?.flight;
      if (room?.phase !== 'playing' || !roles.includes('gunner') || !flight?.ship) return;

      const rect = canvas.getBoundingClientRect();
      const pointer = window.SceneCoordinates.pointerToWorld(event.clientX, event.clientY, rect);
      if (!pointer) return;
      const now = Date.now();
      const candidates = (flight.asteroids || []).map(asteroid => {
        const position = window.SceneCoordinates.asteroidPosition(asteroid, flight, now);
        return { asteroid, position,
        distance: position ? Math.hypot(position.x - pointer.x, position.y - pointer.y) * Math.min(rect.width, rect.height) : Infinity,
        range: Math.hypot(asteroid.x - flight.ship.x, asteroid.y - flight.ship.y)
      }; }).filter(item => item.position && item.range <= .62 &&
        item.distance <= Math.max(30, item.asteroid.radius * Math.min(rect.width, rect.height) * 2.5))
        .sort((a, b) => a.distance - b.distance);
      if (!candidates.length) return;
      selectedAsteroidId = candidates[0].asteroid.id;
      selectedMatchId = room.matchId;
      onSelection(state);
    });
  }

  function render({ round, roles, matchId, isPlaying }) {
    const gunner = isPlaying && roles.includes('gunner');
    if (selectedMatchId !== matchId) {
      selectedMatchId = matchId;
      selectedAsteroidId = null;
      pendingMatchId = null;
    }

    const consoleEl = document.getElementById('gunner-console');
    const targetList = document.getElementById('gunner-target-list');
    const fireButton = document.getElementById('btn-fire-cannon');
    const targetStatus = document.getElementById('gunner-target-status');
    if (consoleEl) consoleEl.hidden = !gunner;

    const flight = round?.flight;
    const ship = flight?.ship;
    const availableTargets = (flight?.asteroids || []).map((asteroid, index) => ({
      asteroid,
      index,
      distance: ship ? Math.hypot(asteroid.x - ship.x, asteroid.y - ship.y) : Infinity
    })).filter(item => item.distance <= .62).sort((a, b) => a.distance - b.distance);
    if (!availableTargets.some(item => item.asteroid.id === selectedAsteroidId)) selectedAsteroidId = null;

    if (targetList) {
      targetList.replaceChildren();
      availableTargets.forEach(({ asteroid, index, distance }) => {
        const targetButton = document.createElement('button');
        targetButton.type = 'button';
        targetButton.className = 'gunner-target' + (asteroid.id === selectedAsteroidId ? ' selected' : '');
        targetButton.setAttribute('aria-pressed', asteroid.id === selectedAsteroidId ? 'true' : 'false');
        targetButton.textContent = `TARGET ${String(index + 1).padStart(2, '0')} · RANGE ${Math.round(distance * 100)}%`;
        targetButton.addEventListener('click', () => {
          selectedAsteroidId = asteroid.id;
          selectedMatchId = matchId;
          window.UI.renderGame(window.App.state);
        });
        targetList.appendChild(targetButton);
      });
    }

    const selected = availableTargets.find(item => item.asteroid.id === selectedAsteroidId)?.asteroid;
    const cooldown = (round?.myCooldowns || {}).pulse_cannon || 0;
    const firing = pendingMatchId === matchId;
    if (targetStatus) {
      targetStatus.textContent = !gunner
        ? 'Gunner controls unavailable for your role.'
        : selected
        ? `TARGET LOCK · ONE-SHOT FIRE · ${selectedAsteroidId}`
        : round?.lastAction?.abilityId === 'pulse_cannon' && Date.now() - round.lastAction.timestamp < 6000
          ? round.lastAction.message
          : availableTargets.length ? 'Select a visible asteroid or choose one below.' : 'NO ASTEROID IN FIRING RANGE';
    }
    if (fireButton) {
      fireButton.disabled = !gunner || !selected || cooldown > 0 || firing;
      const cooldownText = `${Math.ceil(cooldown / 1000)}s`;
      fireButton.textContent = firing ? 'FIRING…' : cooldown > 0 ? `RECHARGING · ${cooldownText}` : 'FIRE PULSE CANNON';
      fireButton.setAttribute('aria-label', firing ? 'Pulse Cannon firing'
        : cooldown > 0
        ? `Pulse Cannon recharging for ${cooldownText}`
        : `Fire one-shot Pulse Cannon at ${selected ? `target ${selectedAsteroidId}` : 'selected target'}`);
      fireButton.onclick = () => {
        if (!gunner || cooldown > 0 || pendingMatchId === matchId || !selectedAsteroidId || !selected) return;
        const firedTargetId = selectedAsteroidId;
        pendingMatchId = matchId;
        render({ round, roles, matchId, isPlaying });
        Promise.resolve(window.App.onUseAbility('pulse_cannon', null, firedTargetId)).finally(() => {
          if (pendingMatchId !== matchId) return;
          pendingMatchId = null;
          const latestRoom = window.App.state?.room;
          const latestPlayer = latestRoom?.players?.find(player => player.isMe);
          render({ round: latestRoom?.round || round, roles: latestPlayer?.roles || (latestPlayer?.role ? [latestPlayer.role] : []), matchId: latestRoom?.matchId || matchId, isPlaying: latestRoom?.phase === 'playing' });
        });
      };
    }
  }

  return { bindCanvas, render, getSelectedTarget: () => selectedAsteroidId };
})();
