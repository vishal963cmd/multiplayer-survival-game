'use strict';

const assert = require('node:assert/strict');
const EventLedger = require('../js/eventLedger');

const ledger = EventLedger.create(3);
const collision = { id: 'match-a:impact_1', damage: 8 };
const controls = { id: 'pilot:action-1', message: 'Pilot steering left.' };
assert.deepEqual(ledger.process('match-a', [collision, controls]), [collision, controls]);
assert.deepEqual(ledger.process('match-a', [collision, controls]), [],
  'repeated poll snapshots do not re-emit the same event IDs');
assert.deepEqual(ledger.process('match-b', [collision]), [collision],
  'a new match receives a fresh event identity scope');
ledger.process('match-b', [{ id: '2' }, { id: '3' }, { id: '4' }]);
assert.deepEqual(ledger.process('match-b', [{ id: 'match-a:impact_1' }]), [{ id: 'match-a:impact_1' }],
  'bounded identity history eventually expires old IDs');
ledger.reset('match-b');
assert.deepEqual(ledger.process('match-b', [collision]), [collision], 'explicit remount reset starts a clean ledger');

console.log('Event ledger tests passed (poll dedupe, match scoping and bounded history).');
