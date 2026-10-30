'use strict';

const assert = require('node:assert/strict');
const { isOlder } = require('../js/flightSnapshots');

const stateAt = (updatedAt, matchId = 'match-a') => ({
  phase: 'playing', matchId, round: { updatedAt, flight: { ship: { x: updatedAt / 1000 } } }
});

assert.equal(isOlder(stateAt(20), stateAt(19)), true, 'late poll snapshots are rejected');
assert.equal(isOlder(stateAt(20), stateAt(21)), false, 'newer authoritative snapshots are accepted');
assert.equal(isOlder(stateAt(20, 'match-a'), stateAt(21, 'match-b')), false, 'a newer rematch is accepted');
assert.equal(isOlder(stateAt(20, 'match-b'), stateAt(19, 'match-a')), true,
  'a delayed previous-match poll cannot rewind a rematch');
assert.equal(isOlder(stateAt(20, 'match-b'), {
  phase: 'results', matchId: 'match-a', updatedAt: 19, round: { updatedAt: 19 }
}), true, 'a delayed previous-match results response cannot end the rematch');
assert.equal(isOlder(stateAt(20), { phase: 'results', matchId: 'match-a', round: { updatedAt: 19 } }), false);

console.log('Flight snapshot tests passed (late polls cannot rewind the current match state).');
