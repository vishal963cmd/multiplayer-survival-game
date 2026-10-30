((root, factory) => {
  const api = factory();
  if (root) root.HullStatus = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  function fromAuthoritative(value) {
    if (!Number.isFinite(value)) return {
      known: false,
      value: null,
      label: '—',
      missionStatus: 'HULL STATUS · SYNCHRONIZING'
    };
    const bounded = Math.max(0, Math.min(100, value));
    return {
      known: true,
      value: bounded,
      label: `${Math.round(bounded)}%`,
      missionStatus: bounded === 0 ? 'HULL BREACH · RESULTS SYNCING' : null
    };
  }

  return { fromAuthoritative };
});
