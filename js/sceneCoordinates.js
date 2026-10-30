((root, factory) => {
  const api = factory();
  if (root) root.SceneCoordinates = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  function extrapolationSeconds(flight, now) {
    const snapshotAt = Number.isFinite(flight?.snapshotAt) ? flight.snapshotAt : now;
    return Math.min(1.6, Math.max(0, (now - snapshotAt) / 1000));
  }

  function asteroidPosition(asteroid, flight, now) {
    if (!asteroid || !Number.isFinite(asteroid.x) || !Number.isFinite(asteroid.y)) return null;
    const elapsed = extrapolationSeconds(flight, now);
    return {
      x: asteroid.x + (Number.isFinite(asteroid.vx) ? asteroid.vx : 0) * elapsed,
      y: asteroid.y + (Number.isFinite(asteroid.vy) ? asteroid.vy : 0) * elapsed
    };
  }

  function pointerToWorld(clientX, clientY, rect) {
    if (!rect?.width || !rect?.height || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  }

  return { extrapolationSeconds, asteroidPosition, pointerToWorld };
});
