'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('css/style.css', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');
const ui = fs.readFileSync('js/ui.js', 'utf8');
const renderer = fs.readFileSync('js/spaceRenderer.js', 'utf8');
const cinematic = fs.readFileSync('js/landingCinematic.js', 'utf8');

assert.match(html, /id="btn-create-room"/, 'Create Room remains in the landing page');
assert.match(html, /id="btn-join-room"/, 'Join Room remains in the landing page');
assert.match(app, /_on\('btn-create-room', 'click'/, 'Create Room remains wired to the app handler');
assert.match(app, /_on\('btn-join-room', 'click'/, 'Join Room remains wired to the app handler');
assert.match(html, /<video id="splash-wayfarer-video" class="splash-background-video" autoplay muted loop playsinline preload="auto" poster="assets\/wayfarer-hero\.png" width="1280" height="720" aria-hidden="true" tabindex="-1"><source src="assets\/wayfarer-space-background\.mp4" type="video\/mp4"><\/video>/,
  'the existing video is one muted, looping, inline full-bleed background with a poster fallback');
assert.equal((html.match(/<video\b/g) || []).length, 1, 'the page contains only one video element');
assert.ok(html.indexOf('id="splash-wayfarer-video"') < html.indexOf('class="splash-topbar"'), 'the background video precedes splash content');
assert.doesNotMatch(html, /class="splash-stage"|class="splash-warship splash-video-blend"/, 'the former framed video stage is removed');
assert.doesNotMatch(html, /class="splash-planet"/, 'the bottom-left planet circle is removed without replacing it');
assert.doesNotMatch(css, /\.splash-planet(?:\s|\{|:)/, 'the obsolete circle styling is removed');
assert.doesNotMatch(html, /class="splash-asteroid(?:\s|\")/, 'all matching floating landing spheres are removed');
assert.doesNotMatch(css, /\.splash-asteroid(?:-|\s|\{|:)/, 'the landing sphere decoration rules are removed');
assert.match(html, /class="splash-video-overlay"/, 'a full-page cinematic overlay is present');
for (const id of ['btn-skip-intro', 'btn-mute', 'btn-create-room', 'btn-join-room']) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} remains present`);
}
assert.match(html, /<h1 class="logo-title">SURVIVE TOGETHER<\/h1>/, 'the hero title remains');
assert.match(html, /MISSION: SURVIVE THE SIGNAL/, 'the mission briefing remains');
assert.match(html, /class="splash-link-status"/, 'fleet identity and distress signal remain');
assert.ok(fs.existsSync('assets/wayfarer-hero.png'), 'the poster fallback exists');
assert.ok(fs.existsSync('assets/wayfarer-space-background.mp4'), 'the supplied video asset exists');

assert.match(cinematic, /video\.muted = true[\s\S]*video\.defaultMuted = true/, 'video stays muted independently of game sound');
assert.match(cinematic, /document\.hidden[\s\S]*motionPreference\?\.matches/, 'video pauses in hidden tabs and for reduced motion');
assert.match(cinematic, /video\.pause\(\)[\s\S]*video\.play\(\)[\s\S]*\.catch\(/, 'video playback is scoped to splash and handles autoplay failure');
assert.match(ui, /LandingCinematic\?\.setActive\(name === 'splash'\)/, 'screen navigation activates landing playback only on splash');

assert.match(css, /\.splash-background-video\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*cover[^}]*pointer-events:\s*none/s,
  'video covers the splash viewport without distortion or intercepting controls');
assert.match(css, /\.splash-video-overlay\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*pointer-events:\s*none/s,
  'overlay covers the splash without blocking interaction');
assert.match(css, /background:\s*#0D1917 url\('\.\.\/assets\/wayfarer-hero\.png'\)/i, 'the static image remains the decoding/error fallback');
assert.doesNotMatch(css, /\.splash-warship-video|\.splash-video-blend|\.splash-video-soften|\.splash-stage\s*\{/,
  'obsolete framed-video rules are removed');
assert.match(css, /\.splash-cosmos\s*\{[^}]*z-index:\s*2/s, 'space accents layer above the video');
assert.match(css, /\.splash-layout\s*\{[^}]*z-index:\s*3/s, 'landing content layers above the video and overlay');
assert.match(css, /\.logo-title\s*\{[^}]*background-clip:\s*text[^}]*text-shadow:[^}]*\d+px \d+px 0/s, 'title retains metallic face treatment and dimensional shadows');
assert.match(css, /\.splash-inner\s*\{[^}]*border:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s, 'content is not shown in a separate card');
assert.match(css, /\.splash-briefing\s*\{[^}]*border:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s, 'briefing blends into the cinematic scene');
assert.match(css, /\.splash-actions \.btn:focus-visible, \.intro-skip:focus-visible\s*\{[^}]*outline:\s*2px solid/s, 'keyboard focus remains visible');
assert.match(css, /\.splash-actions \.btn-secondary\s*\{[^}]*border:\s*1px solid/s, 'Join Room retains a visible boundary');
assert.match(css, /--landing-void:\s*#0D1917/i, 'launch surface retains the forest palette');
assert.match(css, /background:\s*linear-gradient\(135deg, #f2cd7a, #c6a65e\)/i, 'Create Room retains the gold action style');
assert.match(css, /@media \(max-width: 900px\)/, 'tablet layout adapts');
assert.match(css, /@media \(max-width: 680px\)/, 'mobile landing content adapts');
assert.match(css, /@media \(max-width: 390px\)/, 'compact mobile actions stack');
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.splash-nebula, \.splash-inner\s*\{\s*animation:\s*none !important/s,
  'reduced-motion disables decorative landing animation');

assert.match(renderer, /drawShip\(ctx, shipX, shipY, predictedShip\.heading, unit,/, 'gameplay ship remains driven by shared state');
assert.match(renderer, /const size = unit \* \.105;/, 'gameplay ship retains its compact Canvas scale');
assert.ok(renderer.indexOf('drawPulseShot(ctx') < renderer.indexOf('drawShip(ctx, shipX'), 'gameplay ship remains above impact effects');
const coopIndex = html.indexOf('class="cooperative-panel"');
const crewIndex = html.indexOf('class="crew-panel"');
const stageIndex = html.indexOf('<main class="game-stage"');
const canvasIndex = html.indexOf('<canvas id="game-canvas"');
assert.ok(crewIndex < coopIndex && coopIndex < stageIndex && stageIndex < canvasIndex, 'radar and gameplay canvas retain their layout');
assert.match(css, /\.game-body\s*\{[^}]*grid-template-areas:\s*"crew stage role"/s, 'desktop gameplay retains separate crew, flight and role columns');
assert.match(css, /grid-template-areas:\s*"stage"\s*"crew"\s*"role"/, 'narrow gameplay retains its stacked layout');

console.log('Landing and HUD structure tests passed (full-bleed video, controls, layering, fallback, responsive layout, reduced motion and gameplay renderer).');
