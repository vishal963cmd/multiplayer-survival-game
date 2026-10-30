((root, factory) => {
  const api = factory();
  if (root) root.GameLoop = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  function create(requestFrame, cancelFrame, onFrame, onError = error => console.error('[GameLoop] Frame failed:', error)) {
    let running = false;
    let frameHandle = null;
    let lastError = null;

    function tick(timestamp) {
      frameHandle = null;
      if (!running) return;
      try {
        if (onFrame(timestamp) === false) {
          stop();
          return;
        }
        lastError = null;
      } catch (error) {
        // A transient Canvas/layout failure must not permanently kill gameplay
        // rendering. Report once until a clean frame confirms recovery.
        if (!lastError || lastError.message !== error?.message) onError(error);
        lastError = error;
      }
      if (running) frameHandle = requestFrame(tick);
    }

    function start() {
      stop();
      running = true;
      frameHandle = requestFrame(tick);
    }

    function stop() {
      running = false;
      if (frameHandle !== null) cancelFrame(frameHandle);
      frameHandle = null;
    }

    return { start, stop };
  }

  return { create };
});
