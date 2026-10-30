((root, factory) => {
  const api = factory();
  if (root) root.EventLedger = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  function create(limit = 128) {
    let matchId = null;
    let seen = new Set();

    function process(nextMatchId, events) {
      if (nextMatchId !== matchId) {
        matchId = nextMatchId || null;
        seen = new Set();
      }
      const fresh = [];
      for (const event of Array.isArray(events) ? events : []) {
        const id = event?.id;
        if (typeof id !== 'string' || !id || seen.has(id)) continue;
        fresh.push(event);
        seen.add(id);
        if (seen.size > limit) seen.delete(seen.values().next().value);
      }
      return fresh;
    }

    function reset(nextMatchId = null) {
      matchId = nextMatchId;
      seen = new Set();
    }

    return { process, reset };
  }

  return { create };
});
