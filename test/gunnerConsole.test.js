const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function run() {

function element(id) {
  return {
    id, hidden: false, disabled: false, dataset: {}, attrs: {}, children: [], listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    setAttribute(name, value) { this.attrs[name] = value; },
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 500, height: 500 }; }
  };
}

const ids = ['gunner-console', 'gunner-target-list', 'btn-fire-cannon', 'gunner-target-status'];
const elements = Object.fromEntries(ids.map(id => [id, element(id)]));
const calls = [];
const document = {
  getElementById: id => elements[id] || null,
  createElement: tag => element(tag)
};
const context = {
  document,
  window: {
    App: { state: {}, onUseAbility: (...args) => { calls.push(args); return Promise.resolve(); } },
    UI: { renderGame() {} },
    SceneCoordinates: require('../js/sceneCoordinates')
  },
  Math
};
vm.runInNewContext(fs.readFileSync('js/gunnerConsole.js', 'utf8'), context);
const GunnerConsole = context.window.GunnerConsole;
const asteroid = { id: 'rock_aim_test', x: .6, y: .5, radius: .03, health: 3, maxHealth: 3 };
const state = {
  screen: 'game',
    room: {
    phase: 'playing', matchId: 'match-aim-test',
    players: [{ isMe: true, roles: [] }],
    round: { flight: { snapshotAt: Date.now() - 1000, ship: { x: .5, y: .5 }, asteroids: [{ ...asteroid, vx: .1, vy: 0 }] }, myCooldowns: {} }
  }
};
context.window.App.state = state;

const canvas = element('game-canvas');
let selectionRenders = 0;
GunnerConsole.bindCanvas(canvas, () => state, () => { selectionRenders++; });
GunnerConsole.bindCanvas(canvas, () => state, () => { selectionRenders++; });
assert.equal(Object.keys(canvas.listeners).length, 1, 're-entry does not duplicate canvas aim listeners');

GunnerConsole.render({ round: state.room.round, roles: [], matchId: state.room.matchId, isPlaying: true });
assert.equal(elements['gunner-console'].hidden, true, 'non-Gunner cannot see the controls');
assert.equal(elements['btn-fire-cannon'].disabled, true, 'non-Gunner cannot fire');

canvas.listeners.pointerdown({ clientX: 350, clientY: 250, pointerType: 'touch' });
assert.equal(GunnerConsole.getSelectedTarget(), null, 'unauthorized pointer input cannot select a target');

// Promote the same room session to its assigned combined Navigator/Gunner capability.
state.room.players[0].roles = ['navigator', 'gunner'];
canvas.listeners.pointerdown({ clientX: 350, clientY: 250, pointerType: 'touch' });
assert.equal(GunnerConsole.getSelectedTarget(), asteroid.id, 'touch aim selects a real in-range asteroid');
const uiSource = require('node:fs').readFileSync(require.resolve('../js/ui.js'), 'utf8');
assert.match(uiSource, /GunnerConsole\?\.getSelectedTarget\?\.\(\)/,
  'the live animation frame reads the selected target from GunnerConsole for the Canvas reticle');
assert.doesNotMatch(uiSource, /_selectedAsteroidId/,
  'the animation frame never references the undefined selection variable that stopped rendering');
assert.equal(selectionRenders, 1, 'a target selection rerenders the real game UI');

GunnerConsole.render({ round: state.room.round, roles: state.room.players[0].roles, matchId: state.room.matchId, isPlaying: true });
assert.equal(elements['gunner-console'].hidden, false, 'combined role receives Gunner controls');
assert.equal(elements['gunner-target-list'].children.length, 1, 'actual asteroid is shown as a selectable target');
assert.equal(elements['btn-fire-cannon'].disabled, false, 'selected ready target enables FIRE');
assert.match(elements['btn-fire-cannon'].attrs['aria-label'], /rock_aim_test/);
assert.match(elements['gunner-target-list'].children[0].textContent, /RANGE/);
assert.doesNotMatch(elements['gunner-target-list'].children[0].textContent, /HULL|3\/3/,
  'target list no longer advertises multi-hit asteroid health');
assert.match(elements['gunner-target-status'].textContent, /ONE-SHOT FIRE/);
elements['btn-fire-cannon'].onclick();
assert.deepEqual(calls[0], ['pulse_cannon', null, asteroid.id], 'FIRE calls the established App ability action with the selected server target ID');
elements['btn-fire-cannon'].onclick();
assert.equal(calls.length, 1, 'rapid clicks while a shot is pending cannot send duplicate requests');
assert.match(elements['btn-fire-cannon'].textContent, /FIRING/);
await new Promise(resolve => setImmediate(resolve));

state.room.round.flight.asteroids = [];
state.room.round.lastAction = { abilityId: 'pulse_cannon', timestamp: Date.now(), message: 'Gunner shattered the selected asteroid. +50 team score.' };
GunnerConsole.render({ round: state.room.round, roles: ['navigator', 'gunner'], matchId: 'match-test', isPlaying: true });
assert.equal(GunnerConsole.getSelectedTarget(), null, 'a destroyed target clears automatically from local aiming state');
assert.equal(elements['gunner-target-list'].children.length, 0, 'destroyed targets are removed from the list');
assert.match(elements['gunner-target-status'].textContent, /shattered the selected asteroid/,
  'successful destruction shows clear server action feedback');

state.room.round.myCooldowns.pulse_cannon = 1500;
GunnerConsole.render({ round: state.room.round, roles: state.room.players[0].roles, matchId: state.room.matchId, isPlaying: true });
assert.equal(elements['btn-fire-cannon'].disabled, true, 'server cooldown disables the visible control');
assert.match(elements['btn-fire-cannon'].textContent, /RECHARGING/);
elements['btn-fire-cannon'].onclick();
assert.equal(calls.length, 1, 'cooldown cannot fire through a stale button handler');

GunnerConsole.render({ round: state.room.round, roles: state.room.players[0].roles, matchId: 'new-match-id', isPlaying: true });
assert.equal(GunnerConsole.getSelectedTarget(), null, 'aim lock clears at a match boundary');
console.log('Gunner console tests passed (authorization, combined roles, touch aim, single listener, FIRE action wiring, cooldown and match reset).');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
