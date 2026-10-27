// Test writeRoom conflict detection and sanitize
const test = (desc, fn) => {
  Promise.resolve(fn())
    .then(() => console.log('✓', desc))
    .catch(err => console.error('✗', desc, err));
};

const { writeRoom, sanitize } = require('../netlify/functions/game');

// Mock store with setJSON that simulates conflict
const mockStore = {
  async setJSON(key, data, opts) {
    // Simulate conflict when onlyIfMatch is provided
    if (opts.onlyIfMatch) {
      return { modified: false, etag: 'old' };
    }
    // Otherwise succeed
    return { modified: true, etag: 'new' };
  }
};

test('writeRoom returns false on stale etag', async () => {
  const result = await writeRoom(mockStore, 'room1', { foo: 'bar' }, 'stale-etag');
  if (result !== false) throw new Error('Expected false for stale etag');
});

test('writeRoom succeeds when no etag', async () => {
  const result = await writeRoom(mockStore, 'room2', { foo: 'bar' }, null);
  if (result !== true) throw new Error('Expected true when no etag');
});

// Test sanitize does not expose secret player IDs
const sampleRoom = {
  roomCode: 'ABCD',
  phase: 'lobby',
  hostId: 'secret-host',
  players: [
    { id: 'secret-host', nickname: 'Host', role: null, connected: true },
    { id: 'secret-p2', nickname: 'Guest', role: null, connected: true }
  ]
};

test('sanitize hides secret player IDs', () => {
  const out = sanitize(sampleRoom, 'secret-host');
  // Ensure no id fields present in players
  out.players.forEach(p => {
    if ('id' in p) throw new Error('player id should be undefined');
    if (!/^pid_/.test(p.publicId)) throw new Error('publicId does not match pattern');
  });
  // Ensure isHost flag works
  if (out.isHost !== true) throw new Error('isHost flag should be true');
});
