'use strict';

const assert = require('node:assert/strict');
const HullStatus = require('../js/hullStatus');

assert.deepEqual(HullStatus.fromAuthoritative(undefined), {
  known: false, value: null, label: '—', missionStatus: 'HULL STATUS · SYNCHRONIZING'
}, 'missing data is not presented as zero or full hull');
assert.deepEqual(HullStatus.fromAuthoritative(0), {
  known: true, value: 0, label: '0%', missionStatus: 'HULL BREACH · RESULTS SYNCING'
}, 'authoritative zero is explicitly shown as a terminal hull breach');
assert.deepEqual(HullStatus.fromAuthoritative(101), {
  known: true, value: 100, label: '100%', missionStatus: null
});
assert.equal(HullStatus.fromAuthoritative(73.4).label, '73%');

console.log('Hull status tests passed (unknown, bounded values and zero-hull breach).');
