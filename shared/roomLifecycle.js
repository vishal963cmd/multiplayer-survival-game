'use strict';

const HOUR_MS = 60 * 60 * 1000;
const SESSION_IDLE_TTL_MS = 24 * HOUR_MS;
const LOBBY_IDLE_TTL_MS = 24 * HOUR_MS;
const RESULTS_RETENTION_MS = 24 * HOUR_MS;
const CLOSED_RETENTION_MS = HOUR_MS;
const PURGE_RECOVERY_MS = 2 * HOUR_MS;
const ACTIVE_MATCH_CLEANUP_GRACE_MS = 10 * 60 * 1000;

function isSessionExpired(player, now) {
  return !Number.isFinite(player?.lastSeen) || now - player.lastSeen >= SESSION_IDLE_TTL_MS;
}

function isRoomExpired(room, now) {
  const expiresAt = roomExpiryAt(room);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

function roomExpiryAt(room) {
  if (Number.isFinite(room?.expiresAt)) return room.expiresAt;
  if (room?.phase === 'lobby' && Number.isFinite(room.lastActivityAt || room.createdAt)) {
    return (room.lastActivityAt || room.createdAt) + LOBBY_IDLE_TTL_MS;
  }
  if (room?.phase === 'playing' && Number.isFinite(room.round?.startedAt) && Number.isFinite(room.round?.duration)) {
    return room.round.startedAt + room.round.duration + ACTIVE_MATCH_CLEANUP_GRACE_MS;
  }
  if (room?.phase === 'results' && Number.isFinite(room.round?.endedAt)) {
    return room.round.endedAt + RESULTS_RETENTION_MS;
  }
  if (room?.phase === 'closed' && Number.isFinite(room.closedAt)) {
    return room.closedAt + CLOSED_RETENTION_MS;
  }
  return null;
}

function touchRoom(room, now) {
  room.lastActivityAt = now;
  if (room.phase === 'lobby') room.expiresAt = now + LOBBY_IDLE_TTL_MS;
}

function setResultsExpiry(room) {
  if (room.phase === 'results' && room.round?.endedAt) {
    room.expiresAt = room.round.endedAt + RESULTS_RETENTION_MS;
  }
}

function closeRoom(room, now) {
  room.phase = 'closed';
  room.closedAt = now;
  room.expiresAt = now + CLOSED_RETENTION_MS;
  room.players = [];
  room.hostId = null;
  room.round = null;
  room.matchId = null;
  room.rematchVotes = {};
}

function setActiveMatchExpiry(room) {
  const round = room.round;
  if (room.phase === 'playing' && round) {
    room.expiresAt = round.startedAt + round.duration + ACTIVE_MATCH_CLEANUP_GRACE_MS;
  }
}

function promoteHostIfDisconnected(room, now, disconnectTimeoutMs) {
  if (!['lobby', 'results'].includes(room.phase)) return false;
  if (!Array.isArray(room.players) || room.players.length === 0) return false;
  const host = room.players.find(player => player.id === room.hostId);
  if (host && now - (host.lastSeen || 0) < disconnectTimeoutMs) return false;
  const successor = room.players.find(player => now - (player.lastSeen || 0) < disconnectTimeoutMs);
  if (!successor || successor.id === room.hostId) return false;
  room.hostId = successor.id;
  return true;
}

module.exports = {
  SESSION_IDLE_TTL_MS,
  LOBBY_IDLE_TTL_MS,
  RESULTS_RETENTION_MS,
  CLOSED_RETENTION_MS,
  PURGE_RECOVERY_MS,
  ACTIVE_MATCH_CLEANUP_GRACE_MS,
  isSessionExpired,
  isRoomExpired,
  roomExpiryAt,
  touchRoom,
  setResultsExpiry,
  closeRoom,
  setActiveMatchExpiry,
  promoteHostIfDisconnected
};
