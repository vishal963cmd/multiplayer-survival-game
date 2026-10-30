'use strict';

// Retry Canvas renderer initialization after a transient context/layout failure.
// The game HUD can continue updating while the scene waits for a usable context.
(function(root, factory) {
  const api = factory();
  if (root) root.RendererBootstrap = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  function create(canvas, createRenderer, retryMs = 1000) {
    let renderer = null;
    let retryAt = 0;

    function get(now = Date.now()) {
      if (renderer?.available) return renderer;
      if (now < retryAt) return null;
      retryAt = now + retryMs;
      const candidate = createRenderer(canvas);
      renderer = candidate?.available ? candidate : null;
      return renderer;
    }

    return { get };
  }

  return { create };
});
