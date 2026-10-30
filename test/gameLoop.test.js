'use strict';

const assert = require('node:assert/strict');
const GameLoop = require('../js/gameLoop');

let nextHandle = 0;
const pending = new Map();
const cancelled = [];
const requestFrame = callback => { const handle = ++nextHandle; pending.set(handle, callback); return handle; };
const cancelFrame = handle => { cancelled.push(handle); pending.delete(handle); };
const runFrame = (handle, timestamp) => { const callback = pending.get(handle); pending.delete(handle); callback(timestamp); };
let frames = 0;
const loop = GameLoop.create(requestFrame, cancelFrame, () => { frames++; });

loop.start();
const firstHandle = nextHandle;
loop.start(); // Reconnection/re-entry must replace the existing animation frame.
assert.deepEqual([...pending.keys()], [nextHandle]);
assert.deepEqual(cancelled, [firstHandle]);
runFrame(nextHandle, 16);
assert.equal(frames, 1);
assert.equal(pending.size, 1, 'exactly one next frame is scheduled');
loop.stop();
assert.equal(pending.size, 0, 'stop cancels the outstanding frame');
loop.start();
runFrame(nextHandle, 32);
assert.equal(pending.size, 1, 'restarting after reconnect keeps one frame loop');
loop.stop();
assert.equal(pending.size, 0);

let attempts = 0;
let reportedErrors = 0;
const resilientLoop = GameLoop.create(requestFrame, cancelFrame, () => {
  attempts++;
  if (attempts === 1) throw new Error('transient canvas resize');
}, () => { reportedErrors++; });
resilientLoop.start();
let resilientHandle = nextHandle;
runFrame(resilientHandle, 48);
assert.equal(reportedErrors, 1, 'a frame exception is reported');
assert.equal(pending.size, 1, 'a transient render exception does not permanently stop the frame loop');
resilientHandle = nextHandle;
runFrame(resilientHandle, 64);
assert.equal(attempts, 2, 'rendering resumes on the next frame');
resilientLoop.stop();
assert.equal(pending.size, 0);

console.log('Game loop tests passed (re-entry, reconnect, transient errors and cleanup).');
