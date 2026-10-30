((root, factory) => {
  const api = factory();
  if (root) root.FlightSnapshots = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  function isOlder(current, incoming) {
    if (!current || !incoming) return false;
    const currentRevision = Number(current.round?.updatedAt || current.updatedAt || 0);
    const incomingRevision = Number(incoming.round?.updatedAt || incoming.updatedAt || 0);
    if (currentRevision <= 0 || incomingRevision <= 0 || incomingRevision >= currentRevision) return false;

    // Match IDs are random, so they cannot establish ordering. Keep the
    // server-authored revision across rematches to prevent a delayed response
    // from a previous match (including its results snapshot) replacing newer state.
    const currentMatchId = current.matchId || null;
    const incomingMatchId = incoming.matchId || null;
    if (currentMatchId && incomingMatchId && currentMatchId !== incomingMatchId) return true;
    if (current.phase === 'playing' && incoming.phase === 'playing' && currentMatchId === incomingMatchId) return true;
    return false;
  }

  return { isOlder };
});
