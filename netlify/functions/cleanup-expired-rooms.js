'use strict';

const {
  tickGameState,
  DISCONNECT_TIMEOUT_MS
} = require('../../shared/gameRules');
const {
  PURGE_RECOVERY_MS,
  isRoomExpired,
  closeRoom,
  setResultsExpiry,
  promoteHostIfDisconnected
} = require('../../shared/roomLifecycle');
const game = require('./game');

async function cleanupExpiredRooms(store, now = Date.now()) {
  const stats = { scanned: 0, finalized: 0, closed: 0, deleted: 0, conflicts: 0 };
  const pages = store.list({ paginate: true });

  for await (const page of pages) {
    for (const item of page.blobs || []) {
      if (!/^[A-HJ-NP-Z]{6}$/.test(item.key)) continue;
      stats.scanned++;

      const { room, etag } = await game.readRoom(store, item.key);
      if (!room) continue;

      if (room.phase === 'playing' && isRoomExpired(room, now)) {
        tickGameState(room, now);
        if (room.phase === 'results') {
          setResultsExpiry(room);
          promoteHostIfDisconnected(room, now, DISCONNECT_TIMEOUT_MS);
          const written = await game.writeRoom(store, item.key, room, etag);
          if (written) stats.finalized++;
          else stats.conflicts++;
        }
        continue;
      }

      if (!isRoomExpired(room, now)) continue;

      if (room.phase === 'purgePending') {
        if (!Number.isFinite(room.purgeStartedAt) || now - room.purgeStartedAt < PURGE_RECOVERY_MS) continue;
        // A prior cleanup may have stopped after claiming. Reclaim only after
        // the recovery window, and use CAS so one invocation owns deletion.
        room.purgeStartedAt = now;
        const claimed = await game.writeRoom(store, item.key, room, etag);
        if (!claimed) {
          stats.conflicts++;
          continue;
        }
        await store.delete(item.key);
        stats.deleted++;
        continue;
      }

      if (room.phase === 'closed') {
        room.phase = 'purgePending';
        room.purgeStartedAt = now;
        const claimed = await game.writeRoom(store, item.key, room, etag);
        if (!claimed) {
          stats.conflicts++;
          continue;
        }
        await store.delete(item.key);
        stats.deleted++;
        continue;
      }

      closeRoom(room, now);
      const written = await game.writeRoom(store, item.key, room, etag);
      if (written) stats.closed++;
      else stats.conflicts++;
    }
  }

  return stats;
}

exports.config = { schedule: '0 * * * *' };
exports.handler = async function () {
  try {
    const result = await cleanupExpiredRooms(game._store());
    console.log('[signal-shift] Scheduled room cleanup:', result);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    console.error('[signal-shift] Scheduled room cleanup failed:', { name: error?.name, code: error?.code });
    return { statusCode: 500, body: 'Room cleanup failed' };
  }
};

module.exports.cleanupExpiredRooms = cleanupExpiredRooms;
