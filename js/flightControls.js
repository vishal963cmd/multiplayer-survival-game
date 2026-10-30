((root, factory) => {
  const api = factory();
  if (root) root.FlightControls = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  const DIRECTIONS = Object.freeze({
    w: 'up', ArrowUp: 'up',
    s: 'down', ArrowDown: 'down',
    a: 'left', ArrowLeft: 'left',
    d: 'right', ArrowRight: 'right'
  });

  function directionForKey(key) {
    return DIRECTIONS[String(key).length === 1 ? String(key).toLowerCase() : String(key)] || null;
  }

  function vectorForDirections(directions) {
    // Top-down flight axes: horizontal input steers, vertical input throttles
    // (W/up is forward thrust; S/down brakes and reverses).
    return {
      x: (directions.has('right') ? 1 : 0) - (directions.has('left') ? 1 : 0),
      y: (directions.has('down') ? 1 : 0) - (directions.has('up') ? 1 : 0)
    };
  }

  return { directionForKey, vectorForDirections };
});
