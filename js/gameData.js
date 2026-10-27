// ════════════════════════════════════════════════════════════════════════════
// Signal Shift: Survive Together — Browser Game Data
// Browser-compatible version of game constants.
// No CommonJS, no imports — all globals set on the window object.
// ════════════════════════════════════════════════════════════════════════════

window.GAME_DATA = {
  ROUND_DURATION_MS: 90000,
  MAX_PLAYERS: 6,
  MIN_PLAYERS_TO_START: 2,

  ROLES: [
    {
      id: 'engineer',
      name: 'Engineer',
      icon: '🔧',
      color: '#f59e0b',
      description: 'Master of repairs. Can fix any ship system as a fallback.',
      abilities: [
        { id: 'patch_hull',    name: 'Patch Hull',     icon: '🛠️', description: 'Restore 15 hull integrity',                       cooldownMs: 8000  },
        { id: 'boost_shields', name: 'Boost Shields',  icon: '🛡️', description: 'Reduce incoming damage by 50% for 10 seconds',     cooldownMs: 25000 }
      ]
    },
    {
      id: 'navigator',
      name: 'Navigator',
      icon: '🧭',
      color: '#3b82f6',
      description: 'Guides the ship through hazards and spatial anomalies.',
      abilities: [
        { id: 'evade',        name: 'Evasive Maneuver', icon: '↗️', description: 'Cancel an asteroid or navigation emergency',   cooldownMs: 12000 },
        { id: 'chart_course', name: 'Chart Course',     icon: '🗺️', description: 'Prevent navigation failures for 15 seconds',   cooldownMs: 30000 }
      ]
    },
    {
      id: 'systems_officer',
      name: 'Systems Officer',
      icon: '⚡',
      color: '#8b5cf6',
      description: 'Controls ship power distribution and subsystem routing.',
      abilities: [
        { id: 'reroute_power',        name: 'Reroute Power',       icon: '🔌', description: 'Instantly resolve a power surge emergency',     cooldownMs: 18000 },
        { id: 'emergency_broadcast',  name: 'Emergency Broadcast', icon: '📡', description: 'Preview the next emergency 8 seconds early',    cooldownMs: 35000 }
      ]
    },
    {
      id: 'medic',
      name: 'Medic',
      icon: '💊',
      color: '#10b981',
      description: 'Keeps the crew operational under pressure.',
      abilities: [
        { id: 'stabilize', name: 'Stabilize', icon: '❤️', description: 'Prevent life-support hull damage for 20 seconds',    cooldownMs: 22000 },
        { id: 'triage',    name: 'Triage',    icon: '⏩', description: 'Reduce all active ability cooldowns by 4 seconds',  cooldownMs: 40000 }
      ]
    },
    {
      id: 'gunner',
      name: 'Gunner',
      icon: '🎯',
      color: '#ef4444',
      description: 'Eliminates external threats with precision firepower.',
      abilities: [
        { id: 'counter_blast',  name: 'Counter Blast',  icon: '💥', description: 'Destroy an asteroid or radiation threat — +50 score', cooldownMs: 15000 },
        { id: 'point_defense',  name: 'Point Defense',  icon: '🎖️', description: 'Block the next asteroid impact automatically',          cooldownMs: 45000 }
      ]
    },
    {
      id: 'commander',
      name: 'Commander',
      icon: '⭐',
      color: '#f97316',
      description: 'Inspires the crew to peak performance when it matters most.',
      abilities: [
        { id: 'all_hands',        name: 'All Hands',        icon: '✊', description: 'Halve all ability cooldowns for 10 seconds',  cooldownMs: 50000 },
        { id: 'priority_override',name: 'Priority Override', icon: '🚨', description: 'Instantly resolve any one active emergency', cooldownMs: 60000 }
      ]
    }
  ],

  EMERGENCY_TYPES: [
    { id: 'engine_fire',      name: 'Engine Fire',          icon: '🔥', description: 'The engine is on fire! Power failing.',                  resolveRole: 'engineer',       altRole: null },
    { id: 'hull_breach',      name: 'Hull Breach',          icon: '💥', description: 'Hull integrity compromised — seal the breach!',          resolveRole: 'engineer',       altRole: null },
    { id: 'oxygen_leak',      name: 'Oxygen Leak',          icon: '💨', description: 'Oxygen reserves depleting fast!',                        resolveRole: 'medic',          altRole: null },
    { id: 'nav_failure',      name: 'Navigation Failure',   icon: '🧭', description: 'Navigation systems are offline!',                        resolveRole: 'navigator',      altRole: null },
    { id: 'rogue_asteroid',   name: 'Rogue Asteroid',       icon: '☄️',  description: 'Asteroid on collision course! Evade or blast it!',       resolveRole: 'navigator',      altRole: 'gunner' },
    { id: 'power_surge',      name: 'Power Surge',          icon: '⚡', description: 'Uncontrolled power surge through ship systems!',         resolveRole: 'systems_officer',altRole: null },
    { id: 'radiation_burst',  name: 'Radiation Burst',      icon: '☢️', description: 'Radiation levels critical — all hands respond!',         resolveRole: null,             altRole: null }
  ],

  getRoleDef(roleId)      { return this.ROLES.find(r => r.id === roleId) || null; },
  getEmergencyDef(typeId) { return this.EMERGENCY_TYPES.find(e => e.id === typeId) || null; },

  // Can the player's role resolve this emergency?
  canResolve(roleId, emergency) {
    const def = this.getEmergencyDef(emergency.typeId || emergency);
    if (!def) return false;
    if (!def.resolveRole) return true;
    if (def.resolveRole === roleId) return true;
    if (def.altRole === roleId) return true;
    if (roleId === 'engineer') return true; // universal fallback
    return false;
  }
};
