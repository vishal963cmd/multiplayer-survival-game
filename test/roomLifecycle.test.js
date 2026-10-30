'use strict';

const assert = require('node:assert/strict');
const lifecycle = require('../shared/roomLifecycle');
const { cleanupExpiredRooms } = require('../netlify/functions/cleanup-expired-rooms');

const HOUR = 60 * 60 * 1000;
const now = 2_000_000_000_000;

assert.equal(lifecycle.isSessionExpired({ lastSeen: now - lifecycle.SESSION_IDLE_TTL_MS }, now), true);
assert.equal(lifecycle.isSessionExpired({ lastSeen: now - 1000 }, now), false);
assert.equal(lifecycle.roomExpiryAt({ phase: 'lobby', createdAt: now - HOUR }), now - HOUR + lifecycle.LOBBY_IDLE_TTL_MS);

const hostRoom = {
  phase: 'lobby',
  hostId: 'host',
  players: [
    { id: 'host', lastSeen: now - 20_000 },
    { id: 'guest-a', lastSeen: now - 2000 },
    { id: 'guest-b', lastSeen: now - 1000 }
  ]
};
assert.equal(lifecycle.promoteHostIfDisconnected(hostRoom, now, 10_000), true);
assert.equal(hostRoom.hostId, 'guest-a');

function createMockStore(entries) {
  let etagNumber = 0;
  const rooms = new Map(Object.entries(entries).map(([key, data]) => [key, { data: structuredClone(data), etag: `"${++etagNumber}"` }]));
  return {
    rooms,
    async getWithMetadata(key) {
      const entry = rooms.get(key);
      return entry ? { data: structuredClone(entry.data), etag: entry.etag } : null;
    },
    async setJSON(key, data, options = {}) {
      const current = rooms.get(key);
      if (options.onlyIfNew && current) return { modified: false };
      if (options.onlyIfMatch && current?.etag !== options.onlyIfMatch) return { modified: false };
      const etag = `"${++etagNumber}"`;
      rooms.set(key, { data: structuredClone(data), etag });
      return { modified: true, etag };
    },
    async delete(key) { rooms.delete(key); },
    list: async function* () {
      yield { blobs: [...rooms.keys()].map(key => ({ key })) };
    }
  };
}

async function main() {
  const expiredLobby = {
    roomCode: 'AAAAAA', phase: 'lobby', createdAt: now - 25 * HOUR,
    lastActivityAt: now - 25 * HOUR, expiresAt: now - 1,
    hostId: 'p_host', players: [{ id: 'p_host', lastSeen: now - 25 * HOUR }]
  };
  const expiredResults = {
    roomCode: 'BBBBBB', phase: 'results', expiresAt: now - 1,
    round: { endedAt: now - 25 * HOUR }
  };
  const oldClosed = { roomCode: 'CCCCCC', phase: 'closed', closedAt: now - 2 * HOUR, expiresAt: now - HOUR };
  const expiredPlaying = {
    roomCode: 'DDDDDD', phase: 'playing', expiresAt: now - 1,
    round: {
      matchId: 'old-match', startedAt: now - 1_000_000, duration: 90_000,
      hullIntegrity: 100, score: 0, emergenciesResolved: 0, speedBonuses: 0,
      schedule: [], activeEmergencies: [], resolvedEmergencies: [],
      activeBuffs: [], repairCooldowns: {}, lastTickAt: now - 1_000_000
    }
  };
  const stillPlaying = {
    roomCode: 'EEEEEE', phase: 'playing', expiresAt: now + 600_000,
    round: { startedAt: now - 30_000, duration: 90_000 }
  };
  const store = createMockStore({ AAAAAA: expiredLobby, BBBBBB: expiredResults, CCCCCC: oldClosed, DDDDDD: expiredPlaying, EEEEEE: stillPlaying });
  const stats = await cleanupExpiredRooms(store, now);

  assert.equal(stats.scanned, 5);
  assert.equal(stats.finalized, 1);
  assert.equal(stats.closed, 2);
  assert.equal(stats.deleted, 1);
  assert.equal(store.rooms.has('CCCCCC'), false);
  assert.equal(store.rooms.get('DDDDDD').data.phase, 'results');
  assert.equal(store.rooms.get('AAAAAA').data.phase, 'closed');
  assert.equal(store.rooms.get('BBBBBB').data.phase, 'closed');
  assert.equal(store.rooms.get('EEEEEE').data.phase, 'playing');

  const crashedPurge = createMockStore({ FFFFFF: {
    roomCode: 'FFFFFF', phase: 'purgePending', expiresAt: now - 1, purgeStartedAt: now - 1000
  } });
  const earlyRetry = await cleanupExpiredRooms(crashedPurge, now);
  assert.equal(earlyRetry.deleted, 0);
  assert.equal(crashedPurge.rooms.has('FFFFFF'), true);
  const recoveredRetry = await cleanupExpiredRooms(crashedPurge, now + lifecycle.PURGE_RECOVERY_MS + 1);
  assert.equal(recoveredRetry.deleted, 1);

  const sharedClosedRoom = createMockStore({ GGGGGG: {
    roomCode: 'GGGGGG', phase: 'closed', closedAt: now - 2 * HOUR, expiresAt: now - HOUR
  } });
  const concurrentCleanup = await Promise.all([
    cleanupExpiredRooms(sharedClosedRoom, now),
    cleanupExpiredRooms(sharedClosedRoom, now)
  ]);
  assert.equal(concurrentCleanup.reduce((sum, result) => sum + result.deleted, 0), 1);
  assert.equal(sharedClosedRoom.rooms.has('GGGGGG'), false);

  console.log('Room lifecycle and scheduled cleanup tests passed (mock storage; deterministic clock).');
}

main().catch(error => {
  console.error('Room lifecycle tests failed:', error);
  process.exitCode = 1;
});
