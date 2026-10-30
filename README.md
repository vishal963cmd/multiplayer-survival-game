# Signal Shift: Survive Together

> Real-time multiplayer browser game — Handshake AI Skills Studio × OpenAI "Create a Multiplayer Game" mission.

**2–6 players · No account required · Share a 6-letter room code**

Players are a spaceship crew facing 90 seconds of escalating emergencies. Coordinate roles, respond to threats, and keep the hull above zero to win.

The launch screen uses the supplied locally stored Wayfarer MP4 as a muted, looping full-screen background behind the fleet identity, cinematic forest-green overlays, metallic title and mission briefing. The original hero PNG remains the static video poster/fallback. No remote media service is required; reduced-motion preferences pause video and disable decorative animation.

---

## Quick Start (Local Development)

### Prerequisites
- Node.js 22.13+ for the current Netlify CLI; the function runtime itself supports Node.js 18+
- [Netlify CLI](https://docs.netlify.com/cli/get-started/) (`npm install -g netlify-cli`)

### 1. Install dependencies
```bash
npm install
```

### 2. Link to Netlify (one-time, for Blobs support)
```bash
netlify link
```
> If you don't have a Netlify site yet: `netlify sites:create --name signal-shift-game`

### 3. Run locally
```bash
npm run dev
# or: netlify dev
```
Open `http://localhost:8888` in two browser tabs to test multiplayer.

---

## Project Structure

```
/
├── index.html                 ← Single-page app (all screens)
├── netlify.toml               ← Build + function config
├── package.json
├── css/
│   └── style.css              ← Full design system (no framework)
├── js/
│   ├── gameData.js            ← Browser-compatible role/emergency data
│   ├── sound.js               ← Synthesized Web Audio API sounds
│   ├── actions.js             ← API call wrappers (all calls to /.netlify/functions/game)
│   ├── poller.js              ← serialized, bounded polling with retry backoff
│   ├── ui.js                  ← DOM renderer
│   ├── spaceRenderer.js       ← Original Canvas space scene, ship, rocks and impact effects
│   ├── sceneCoordinates.js    ← Shared snapshot extrapolation and pointer/world mapping
│   ├── eventLedger.js         ← Match-scoped idempotent client event processing
│   ├── hullStatus.js          ← Authoritative, unknown, and zero-hull HUD states
│   ├── flightControls.js      ← Host keyboard thrust/steering mapping
│   ├── flightSnapshots.js     ← Same-match late snapshot protection
│   ├── gameLoop.js            ← Single-frame-loop lifecycle for re-entry/reconnect
│   ├── gunnerConsole.js       ← Touch/mouse target selection and guarded FIRE control
│   └── app.js                 ← Application state machine
├── shared/
│   ├── gameRules.js           ← CommonJS game logic (server-only import)
│   └── spaceflight.js         ← Deterministic movement, asteroid and collision model
└── netlify/
    └── functions/
        └── game.js            ← Single Netlify Function, all actions
```

**Key constraint:** helper logic lives in `/shared/`, not inside `netlify/functions/`. The function imports with `require('../../shared/gameRules')`.

---

## Architecture

### Why this stack

| Layer | Technology | Reason |
|---|---|---|
| Frontend | Vanilla HTML + CSS + JS | Zero build, instant deploy, reviewer-friendly |
| Backend | Netlify Functions (Node.js) | Serverless, free tier, handles all game logic |
| State store | Netlify Blobs (strong consistency) | Persistent KV, ETag conditional writes |
| Real-time | Client polling (1500ms lobby, 750ms flight, 500ms active projectile) plus input-edge requests | Serverless functions do not hold a WebSocket; snapshots synchronize the shared flight state |

### Server authority
All timers, hull integrity, scores, emergency state, ship position and asteroid collisions live exclusively in the room record in Netlify Blobs. The host submits only a validated direction vector; the server advances movement and collision state. Client Canvas animation extrapolates the latest server snapshot and never writes state per frame.

### Concurrency protection
Each room is stored as one blob. Mutations read strongly and write with Netlify Blobs `onlyIfMatch` ETags; room creation uses atomic `onlyIfNew`. On a stale ETag, the function re-reads and retries up to four times. Netlify documents these conditional writes as atomic. This protects a single room key across function instances; it does not provide transactions spanning multiple keys. Netlify Dev's sandbox omits ETags, so only local development uses a per-process queue. That queue is not a production coordination mechanism.

Every active `get_state` poll also advances and writes the authoritative room, so browser polling is intentionally serialized and spaced after each response. Lobby polling is 1500 ms, active flight is 750 ms, and an in-flight projectile uses 650 ms; failed polls back off from 1500 ms to a maximum of 8000 ms. At an observed production no-room API baseline of 0.725–1.273 s, the response-plus-delay model projects about 187–262 requests/minute for six clients sharing an IP during active projectile polling, below the configured 300/minute per-IP/domain limit. This is a projection, not a measurement of valid room/Blob calls or proof of production gameplay latency.

### Multiplayer is real
This is **not** two independent local-state browser tabs. Every poll reads from the same Netlify Blob, and every action writes to it. Players on separate phones see the same hull, emergencies, ship position, asteroid field, impact events and timer. Only the room host steers the shared ship; other crew members coordinate emergencies and abilities.

---

## Gameplay Overview

| | |
|---|---|
| **Duration** | 90 seconds per round |
| **Starting hull** | 100% |
| **Win** | Timer reaches 0 with hull > 0, at least 3 resolved emergencies, and 2 distinct crew members contributing an ability (normal-length rounds) |
| **Lose** | Hull reaches 0 |

### Roles (assigned by join order when the host starts)

| Players | Roles |
|---|---|
| 2 | Pilot + Engineer; Navigator + Gunner |
| 3 | Pilot; Engineer; Navigator + Gunner |
| 4 | Pilot; Engineer; Navigator; Gunner |
| 5 | Pilot; Engineer; Navigator; Gunner; Power Systems Operator |
| 6 | Pilot; Engineer; Navigator; Gunner; Power Systems Operator; Communications Officer |

Combined roles receive each listed role's authorized abilities. The Engineer can respond as the emergency fallback. In 2–6 player matches the host is assigned Pilot; host flight authority is separate from the Gunner's aim and fire controls.

The launch screen presents one muted cinematic Wayfarer video as the full-screen background, using the existing ship illustration as its poster/fallback. In a match, a Gunner aims by clicking or tapping a visible in-range asteroid, or choosing its accessible target button, then presses **FIRE PULSE CANNON**. One press requests one server-validated projectile; the asteroid stays alive while that projectile travels. The server advances it with the shared flight tick and removes the selected target, awards +50, and publishes impact effects only after swept collision confirms a hit. Mouse/touch aiming is independent of Pilot movement. No keyboard firing shortcut is assigned.

Gameplay scene rendering uses shared snapshot extrapolation for asteroid display and pointer aim, so the aim point tracks the same predicted position as the drawn rock. The Canvas draws its space background through delayed/invalid flight snapshots, skips malformed individual asteroids, and continues the existing single animation loop after a reported transient frame exception. Collision and action notifications are match-scoped by stable event IDs; repeated polling cannot re-emit the same impact toast or crew-feed event. At most three toasts are visible. Missing hull data is shown as unknown, while zero hull is labeled as a breach during the server's results transition.

### Emergencies

Emergencies spawn on a pre-generated Poisson schedule (seeded by `startedAt`). The first emergency always appears at 15 seconds (tutorial window). After that, mean inter-arrival time decreases from 15s to 8s as the round progresses.

| Type | Damage | Resolved by |
|---|---|---|
| Engine Fire | 3 HP/s | Engineer |
| Hull Breach | 5 HP/s | Engineer |
| Oxygen Leak | 2 HP/s | Medic / Engineer fallback |
| Nav Failure | 1 HP/s + 5 on expiry | Navigator / Engineer fallback |
| Rogue Asteroid | 12 HP on expiry | Navigator or Gunner |
| Power Surge | 2 HP/s + 8 on expiry | Engineer fallback |
| Radiation Burst | 4 HP/s | **Any crew member** |

### Scoring

```
Win:  1000 + (remaining_seconds × 10) + (hull% × 5) + (resolved × 75) + (speed_bonuses × 25) + combat_score + communications_score
Lose: (hull% × 5) + (resolved × 75) + (speed_bonuses × 25) + combat_score + communications_score
```

Speed bonus: +25 for each emergency resolved within 5s of spawning.
Combat score: +50 for each validated Gunner pulse-cannon asteroid destruction or Counter Blast emergency resolution. Communications score: +100 for the one server-validated signal task in a six-player match.

The results screen reports the component values used for the team total and successful role contributions: Pilot maneuvers, Navigator marks/diversions, Engineer repairs, restored hull and shield activations, Gunner cannon hits/asteroid destructions, Power Operator allocations/boosts, and Communications signal confirmations. Contribution counters reset with each new match. Rejected, replayed, or no-op actions do not earn contribution credit.

### Shared threat radar and crew events

- The compact Navigator radar plots only current server-simulated asteroids within range relative to the ship. It shows bearing, distance, and a high/watch/low risk derived from relative trajectory; it does not invent a time-to-impact value.
- The Navigator can mark a real in-range asteroid. The server checks role, player session, current match, asteroid, range, replay receipt, and cooldown. The marker expires after 8 seconds and both clients receive the same mark and bounded crew-event feed.
- Marking does not itself count as an ability contribution or avoidance reward. A diversion is credited only when the validated Navigator ability actually diverts the marked rogue asteroid.
- The shared event feed retains at most eight recent authoritative events. It reports successful marks, pilot changes, collision damage, emergency resolutions, repairs, shield activations, and objective completion.
- The Gunner aims independently by clicking/tapping a visible in-range asteroid on the Canvas or selecting its accessible target button, which shows range. A reticle locks onto the selection; **FIRE PULSE CANNON** is a separate accessible button. One server-validated shot destroys exactly its selected asteroid, awards +50 combat score once, and publishes a match-scoped event containing its actual hit point. Base cooldown is 1.8 seconds and the server adjusts it for weapon power allocation. Cosmetic trails, flashes and debris are derived locally from that event; the selected target is cleared when it disappears from shared state.
- The Power Systems Operator's three integer allocations must total 100: engine power scales authoritative acceleration, shield power reduces collision damage by up to 30%, and weapon power adjusts the Pulse Cannon cooldown. Engine Overdrive costs 30 of the match's 100 reserve energy, lasts 8 seconds, and has a 25-second cooldown.
- The Communications Officer receives one 30-second signal task in a six-player match. Match the three-symbol sequence to one of four options. The server keeps the correct option private, accepts one completion, and awards +100 team points once; expired tasks cannot be submitted.
- Results show survival duration, final hull, resolved emergencies, rapid-response points, role contribution counters, and the server-computed score breakdown. Rematches receive a fresh match ID and reset these match-scoped values.

### Flight controls and collisions

- The host pilots with **WASD** or the **arrow keys**: **W / Up** accelerates forward, **S / Down** brakes without reversing, and **A/D / Left/Right** steer. The ship builds speed with thrust, coasts with damping, and turns in the direction of steering. Guests see who has the helm; all clients render the same server-owned ship state.
- On a normal-length mission, the shared crew objective is to survive the timer, resolve three emergencies, and have two different crew members use an ability. Short test rounds omit these progress requirements.
- The active world uses a locally bundled original generated space image and a separate transparent Wayfarer sprite for the playable ship. The sprite follows the same authoritative predicted position and heading as the previous Canvas ship; movement, hitbox, server state and game rules are unchanged. If it fails to load, the original Canvas ship drawing remains as a fallback. Asteroids use individually seeded irregular silhouettes, cached procedural rock materials with craters, mineral texture, fractures, directional shading and persistent hit marks; asteroid count stays capped at eight.
- The original supplied cinematic MP4 remains bundled but is not placed behind gameplay because its large foreground ship is baked into changing camera shots. No external art service or runtime network asset is needed.
- Rock textures are generated once per visible shape and cached in a bounded browser-side cache. Impact flashes, shock rings, sparks and cosmetic rock fragments are reconstructed from stable server event IDs; they never collide or affect hull, score or mission progress.
- The server checks swept paths on each room tick. A collision consumes that asteroid, damages shared hull (reduced by Boost Shields), and publishes a short-lived impact event. Point Defense blocks one collision.
- Pilot input is **W / Up** thrust, **S / Down** brake, and **A/D / Left/Right** steer; movement is host-only. Gunner aim/fire uses pointer/touch target selection and the visible FIRE button, independent of the Pilot keys. Communications uses the on-screen sequence buttons. Power allocation uses three numeric fields plus APPLY; Engine Overdrive is an ability button.
- Course updates are sent when the direction changes and refreshed through the existing host poll. The server clears stale controls after 4.5 seconds without a host poll. Animation frames stay local and do not write to Blobs.
- Rendering repair note: DevTools reproduction traced the blank scene to an undeclared selected-target variable in the animation-frame renderer call. The loop raised `ReferenceError` before drawing the shared world. It now reads the current selection from `GunnerConsole`; automated regression and shared host/guest snapshot parity tests pass. A fresh post-fix active browser match is still required to confirm visible pixels.

### Crew chat

The room chat control is available in the lobby, active match, and results. Messages are submitted to the existing Netlify game function and stored with that room, then delivered in authenticated room snapshots through the existing poll. The server derives the sender callsign from the session, normalizes and validates up to 500 characters, limits each player to five messages per 10 seconds, suppresses recent repeated request IDs, and retains at most 100 messages. The UI uses text nodes for message content; HTML-like input is shown literally. This is room-state chat, not hosted multi-instance or browser-tested delivery evidence.

---

## Testing

Run the complete configured regression suite with:

```bash
npm test
```

### Unit test (game rules logic)
```bash
node test/gameRules.test.js
node test/spaceflight.test.js
```

### Real API integration test
Start the local Netlify server in Terminal 1:

```bash
npm run dev
```

Then run the integration test in Terminal 2:

```bash
npm run test:integration
```

The integration test creates sandboxed local rooms, checks persistence and invalid codes, and sends simultaneous joins at the last available slot. It does not access production room data. To use a non-default local port, pass the function URL:

```bash
npm run test:integration -- http://localhost:18888/.netlify/functions/game
```

For short deterministic integration matches, start Netlify Dev with these test-only settings, then run the integration command in a second terminal. Netlify Dev shortens rounds when both `ENABLE_TEST_MODE=true` and `TEST_ROUND_DURATION_MS` are set. Outside Netlify Dev, test-mode requests also require an explicit `testMode` body flag.

PowerShell:
```powershell
$env:ENABLE_TEST_MODE = 'true'
$env:TEST_ROUND_DURATION_MS = '5000'
npm run dev -- --port 18888 --staticServerPort 18999 --functions-port 18998
```

Bash:
```bash
ENABLE_TEST_MODE=true TEST_ROUND_DURATION_MS=5000 npm run dev -- --port 18888 --staticServerPort 18999 --functions-port 18998
```

The API handler and room-cleanup unit tests use mocked ETag storage and deterministic time; they do not prove Netlify deployment behavior. The HTTP integration test uses the local Netlify Dev Blobs sandbox. Multi-instance behavior and Netlify's rate-limit enforcement require a deploy preview/staging environment.

### Manual two-player test
1. `npm run dev`
2. Open `http://localhost:8888` in Tab A → Create Room
3. Open `http://localhost:8888` in Tab B → Join Room (use the code from Tab A)
4. Host clicks Launch Mission
5. Verify both tabs see the same timer, hull, and emergencies
6. Resolve emergencies and verify score updates on both tabs
7. Host steers with WASD/arrow keys; both tabs should see the same ship path and asteroid field
8. Let an asteroid hit or steer into one; both tabs should see one explosion and the same hull reduction

### Disconnect and refresh test
1. Start a 2-player game
2. Refresh Tab B — its `sessionStorage` token restores the same player without adding a duplicate
3. Close Tab B and wait 10s — Tab A should show the second player as disconnected (grey dot)
4. Reopen the same tab/session before the 24-hour idle expiry — the server verifies room membership and reconnects that player

### Chaos test
1. Open 6 tabs, all join the same room
2. All click abilities simultaneously
3. Verify hull and score remain consistent (no double-apply)

---

## Deployment

### Deploy to Netlify

#### Option A — Netlify CLI
```bash
netlify deploy --prod
```

#### Option B — Netlify UI
1. Push to a GitHub repository
2. Go to `app.netlify.com` → New site from Git
3. Build command: *(leave empty — no build step)*
4. Publish directory: `.`
5. Click Deploy

#### Required Netlify settings
- **Node.js version**: 18+ for the deployed function runtime. Local Netlify CLI development requires Node.js 22.13+.
- **Blobs**: automatically provisioned when you deploy a function that uses `@netlify/blobs`
- The game function exports a Netlify per-IP/domain limit of 300 requests per 60 seconds. Active poll spacing is documented above; actual requests also depend on response latency, actions, retries, and whether clients share an IP. Netlify documents that enforcement can take up to 10 seconds to begin, so this is abuse mitigation rather than an instantaneous cap. Verify the rule in a deploy preview before release.
- The scheduled cleanup function runs hourly. Lobby rooms expire after 24 hours without activity; active matches are retained through their 90-second round plus a 10-minute cleanup grace; results remain for 24 hours; closed records are purged after one additional hour. Cleanup finalizes an expired active match before setting result retention. It never expires an active match based on a player disconnect alone.

### Player sessions and room lifecycle
- The generated player ID is a bearer token. The browser stores it in that tab's `sessionStorage` so refresh/network recovery can request state without exposing the token in a URL. The API rechecks that token against room membership; idle sessions expire after 24 hours.
- Explicitly leaving from a lobby or results screen removes the player and revokes that token. Leaving during an active match is not offered; closing the tab marks the player disconnected after 10 seconds and the same session can reconnect before expiry.
- If a host remains disconnected after the 10-second grace in a lobby or results room, the earliest currently connected remaining player becomes host. A brief disconnect does not remove membership.
- Cleanup uses ETag compare-and-swap to close a room and claim purging before deletion. If a cleanup invocation stops after claiming, a later run may reclaim the record after a two-hour recovery window. Expired room deletion is configured in code but was not run against production data as part of this work.

### Verify deployment
After deploy, open `<your-netlify-url>` on two separate phones and play a full round.

---

## Environment Variables

No application secrets are required. Netlify Dev 27+ injects a sandboxed local Blobs context, including its uncached endpoint. The function preserves that context for strong-consistency reads. Lambda-compatible runtime events are used only when a complete runtime context is not already present. `ENABLE_TEST_MODE` and `TEST_ROUND_DURATION_MS` are optional local integration-test settings; do not set them in a production environment.

---

## Design Decisions

1. **Single function** with `action` discriminator — no routing complexity, no multi-endpoint CORS
2. **No framework** on frontend — source is readable instantly, zero build step
3. **Seeded Poisson schedule** computed at game start — deterministic, stored in blob, no re-computation needed
4. **Engineer fallback** — ensures every emergency is solvable with 2 players
5. **RAF-driven timer** — the client interpolates the remaining time between polls for a smooth countdown display; server anchor time is refreshed on every poll
6. **Lazy-tick architecture** — damage, expiry, and win/lose checks happen server-side on every request, not in a background timer

---

## Known Limitations (v1)

- No persistent leaderboard (by design — no database)
- Polling latency: actions can take up to 1.5s to appear on other clients
- Room codes expire with the Netlify Blob (1 hour TTL by default)
- Sound requires a user gesture to initialise (browser Web Audio API restriction)

### Active gameplay ship rendering

The central flight canvas draws a compact, original Canvas Wayfarer silhouette from the shared `round.flight.ship` snapshot and shared physics prediction. The renderer draws the ship after current asteroids, impact effects, and Gunner weapon visuals; it does not require the landing hero image to load. A separate regression protects these rendering inputs and order. Browser-level proof of live movement on both clients remains outstanding.

### Renderer recovery and visual identity

Gameplay uses the existing isolated Canvas Wayfarer (not the landing poster), with a forward-right hull, forest/cream plating, muted-gold engine cues, metallic high-contrast asteroid materials and the charcoal/forest tunnel. Both entities are rendered from the shared flight snapshot; the client predicts presentation only and never mutates shared state. Valid asteroids continue to draw if a ship snapshot is malformed. The renderer may display its last valid ship snapshot for up to three seconds within the same match, then waits for a valid snapshot; it clears that fallback when the match ID changes. Offscreen rock-texture failure falls back to direct procedural drawing, and a temporarily zero-sized canvas retries when layout becomes measurable.

The Canvas regression suite injects the six requested viewport measurements and DPR values, then checks measured-container resizing, backing-buffer dimensions, normalized ship placement, and real ship/asteroid draw paths. An unavailable initial Canvas context is now retried at a bounded interval so one failed initialization cannot permanently leave a black scene. These are renderer tests, not browser viewport evidence. The current report of a black scene at wide screen sizes has not been reproduced with trustworthy browser measurements, so its specific root cause remains open. The landing mission briefing is now borderless and transparent; the original Wayfarer has restrained horizontal/vertical drift and slight banking, with the existing reduced-motion override retained. Live viewport appearance, animation smoothness, and landing interactions remain browser-verification items.

### Latest viewport verification

An isolated Chrome/CDP browser run against the existing local Netlify Dev server reproduced and fixed the wide-screen blank gameplay canvas. Both clients resized through 360×800, 390×844, 768×1024, 1366×768, 1920×1080 and 2560×1440, then back without reload. Every step displayed the ship and at least six asteroids on nonzero Canvas surfaces; Pilot thrust and server-validated Gunner asteroid damage synchronized between clients. The landing page was checked at small mobile, laptop, desktop and ultrawide sizes, including motion/reduced-motion, audio and Skip Intro. Screenshots and report: `test-artifacts/phase17b-2026-10-29T20-34-50-823Z/`.

This evidence covers two clients, not the six-player ceiling or every ability/mission path. Production deployment and multi-instance behavior remain unverified.

### Gameplay space and Wayfarer assets

**Current as of Phase 24:** The Phase 22 generated gameplay background and ship sprite described below are historical, preserved assets and are not mounted or drawn. Gameplay uses the recovered original procedural Canvas space and original compact, heading-aligned Canvas ship. The video remains preserved but unused.

Phase 22 corrects the earlier video-as-gameplay-background approach. Inspection of four video frames showed a foreground carrier changing angle, framing and size across the clip, so local segmentation would leave masks or ship ghosts. The supplied MP4 remains unmodified at `assets/wayfarer-space-background.mp4`; it is no longer displayed in gameplay. Two separate original generated assets based on the video's palette and ship design are bundled: `assets/wayfarer-gameplay-space.png` (clean space-only backdrop) and `assets/wayfarer-gameplay-ship.png` (transparent 1792×1024 Wayfarer sprite). The sprite is drawn at the existing authoritative, predicted ship position and heading. If it fails to load, the original Canvas ship remains the fallback. Normal asteroids retain textured silhouettes without permanent circular outlines.

Real Chrome/CDP evidence: `test-artifacts/phase17b-2026-10-29T21-35-49-688Z/report.json` and screenshots. Two clients reached a real local match; the clean image and transparent sprite loaded, both backgrounds covered the scene at six viewport sizes in both directions, the sprite rendered for both clients, asteroids remained visible, Pilot W/A movement and heading replicated, a Gunner shot changed host-observed asteroid health from 3 to 2, and landing interactions passed. The browser captured zero errors. Gunner destruction and score synchronization were not verified in this run. Six-player browser coverage, production delivery and ordinary-device performance remain unverified. The generated background is a still image, not a reconstructed looping video.

Phase 23 reduces the Canvas overlay that previously made this composition look like effects layered over a photograph: radial accents are capped at 12 rays and moving trails at 96, with shorter/dimmer trails, a softer edge vignette and reduced ship shadow. The game retains subtle parallax stars, textured asteroids, optional selected-target marks and its gameplay effects. Visual screenshot evidence at 1920×1080 and 360×800, plus the viewport matrix and browser report, is under `test-artifacts/phase17b-2026-10-29T21-51-33-761Z/`. Background, sprite, ship/asteroid rendering and responsive checks passed; the harness exited on its final Pilot rotation probe, which did not observe a heading change in that run. It logged no browser errors. The prior Phase 22 two-client run observed both Pilot thrust and rotation.

## Phase 24 — Restored gameplay ship and space (2026-10-30)

The staged last-known-good `js/spaceRenderer.js` provided the recoverable original renderer. Gameplay again draws its original blue-gray ship silhouette directly in Canvas at the shared predicted position and heading, with the original compact `unit * .105` scale and attached thrust, shield and hull-hit cues. The original procedural charcoal space background is also restored in that Canvas (680 ambient particles and 112 tunnel rays). The Phase 22 generated gameplay image and ship sprite remain preserved but are unreferenced; the supplied video remains preserved and unused. No gameplay UI, physics, authoritative state, or API behavior was changed.

Verification: `npm test` passed; `.\\node_modules\\.bin\\netlify.cmd build` passed and bundled both functions; real isolated Chrome/CDP verification against the existing local Netlify Dev server completed for host and guest at 360×800, 390×844, 768×1024, 1366×768, 1920×1080 and 2560×1440. Screenshots show one playable ship and multiple textured asteroids against the original background, without media layers. Pilot thrust and rotation replicated to the guest; a Gunner shot changed asteroid hull 3→2 on the host; responsive Canvas, both-client match IDs, landing controls, reduced motion, and zero browser errors passed. Gunner destruction with synchronized score was not completed in this run. Detailed evidence is in `test-artifacts/phase17b-2026-10-30T03-27-10-952Z/`.

### Phase 25 evidence: landing video and one-shot cannon

The supplied MP4 is byte-identical to the existing local copy (SHA-256 `AC1B7C99794B30E55F836D011DDAF10E5C95BFEAB3485A26258837F4B43B470F`). It is used only in the landing hero. It decodes at 1280×720 for 10.005 seconds; the original ship PNG is the video poster/fallback. The video is muted, inline and looping, starts only on the splash, pauses for hidden tabs/reduced motion/Skip Intro, and uses metadata preload, contained sizing, screen blending and a two-axis feather to blend out frame edges.

A Gunner's single accepted server-validated Pulse Cannon shot destroys its selected asteroid regardless of prior health, shares a match-scoped impact/destruction event, removes the target from both clients, and awards +50 once. The existing role, range, cooldown, replay and room protections remain. Real two-client local Chrome verification observed one shot, target removal and score 0→50 on both clients; the other original asteroid IDs remained. Pilot thrust/rotation and landing Create/Join, mute and Skip Intro worked. At 375×812, 768×1024, 1024×768, 1440×900 and 1920×1080 the video decoded/played with no horizontal overflow; screenshots were inspected. Report and images: `test-artifacts/phase17b-2026-10-30T05-08-16-682Z/`. Local full-loop wrap, real mobile hardware performance, six clients and deployed/multi-instance behavior remain unverified.

### Phase 26 evidence: full-screen cinematic landing video

The existing Wayfarer MP4 now fills the entire splash as one muted, looping, inline background video using `object-fit: cover`. The former left-side frame and masks are removed. The forest-dark overlay, title, mission briefing, fleet/distress identity, Create/Join buttons, audio toggle and Skip Intro remain above it. The local hero poster is the fallback, with hidden-tab/reduced-motion/Skip playback behavior retained.

Isolated local Chrome measured and captured the landing page at 375×812, 768×1024, 1024×768, 1440×900 and 1920×1080. At all five sizes the video and overlay cover the viewport, video decodes and plays muted/inline/looped, content and controls remain in bounds without overlap or horizontal scrolling, and the landing interactions/reduced-motion checks pass. Final captures/report: `test-artifacts/phase17b-2026-10-30T05-17-38-657Z/`. The broader two-client harness subsequently exited because its independent Pilot movement/rotation probe did not observe input; this landing phase makes no claim about that gameplay check. See `.gsd/ROADMAP.md` for the complete evidence and final test/build status.

### Phase 27: remove the bottom-left green circle

Removed the landing-only `.splash-planet` decoration and its dedicated CSS rules so the full-screen spaceship video is visible underneath. The background video, its size and alignment, overlays, remaining atmosphere, landing content, and responsive layout are unchanged. A regression test protects the circle's absence.

Local Chrome verified mobile, laptop and desktop screenshots and passed the full five-viewport layout/playback check with zero browser errors. Evidence: `test-artifacts/phase17b-2026-10-30T05-21-40-528Z/`. `npm test`, the project-local Netlify build and staged/unstaged diff checks passed.

### Phase 28: remove floating black spheres

Removed only the three landing-only sphere decorations and their dedicated placement/surface CSS rules. The full-screen video, video playback and position, overlays, remaining atmospheric layers, layout, content, controls and gameplay asteroid rendering are unchanged. Regression coverage keeps the landing sphere nodes and CSS absent.

Local Chrome verified all five responsive viewport sizes; the complete browser harness passed with zero errors. Mobile and desktop captures show the spheres removed. Evidence: `test-artifacts/phase17b-2026-10-30T05-23-36-678Z/`. `npm test`, project-local Netlify build and Git diff checks passed.

## Phase 29 — complete local audit (2026-10-30)

This is an evidence ledger, not a production-readiness declaration. Scope is the existing Netlify Functions/Blobs implementation and the current checkout. Source inspection covered the requested app, tests, assets, configuration and GSD records.

| Area | Status | Evidence / remaining limit |
|---|---|---|
| Landing video, overlays, controls, sphere/planet removal, responsive sizes, reduced motion | PASS (local browser) | Chrome/CDP report `test-artifacts/phase17b-2026-10-30T05-59-24-594Z/report.json`; 360, 390, 768, 1024, 1366, 1440, 1920 and 2560 px gameplay sizes plus 375, 768, 1024, 1440 and 1920 px landing sizes; zero browser errors. Keyboard accessibility is covered structurally and by focused tests, not a full assistive-technology audit. |
| Room create/join, six-character code, duplicate nickname/session, capacity and roles | PASS (local browser/API) | Browser created/joined a two-client match; live Netlify Dev integration exercised room lifecycle, duplicate join rejection, six roles/seats, seventh-player rejection and capacity concurrency. |
| Pilot movement/rotation and shared ship/asteroid rendering | PASS (two local browser clients) | Host thrust/rotation and peer observation passed; scene/background/ship/asteroids rendered at tested widths and resized without reload. Focused tests cover WASD/arrows and acceleration/braking; browser did not manually exercise every key. |
| Gunner projectile and one-shot collision | PASS (focused local browser + live API + handler tests) | FIRE left its target alive and score unchanged while both clients held the active projectile; their extrapolated positions agreed within 0.06 world units. A later server swept collision removed only the target and synchronized +50. The focused browser report/captures are listed in the Phase 30 record. The broader responsive harness later exited because its short local test round ended during the viewport sweep. |
| Navigator marking | PASS (live local API) | Valid Navigator mark appeared in host room state; host Pilot request was denied. All Navigator abilities were not separately exercised in a full browser match. |
| Multiplayer chat | PASS (live local API) | Two-way room-scoped messages, identity/order, isolation, duplicate and rate-limit behavior passed integration; safe text rendering is covered by source/UI tests. Enter-to-send was not exercised in the current browser run. |
| Engineer abilities, emergencies, collision damage, mission completion, victory/defeat, results/rematch | IMPLEMENTED / PARTIALLY VERIFIED | Deterministic game-rule/API-handler tests cover collision hull damage, emergency timers/response, mission win/defeat, result scoring and rematch/stale-match protections; integration/browser evidence covers only selected abilities and the active two-client round. Full 90-second mission, each emergency/ability, and rematch were not completed in this browser run. |
| Reconnect, host handoff, expiry/cleanup, rate limits, replay protection, validation, CAS/storage | PASS (tests/local API as applicable) | Deterministic lifecycle/handler tests and local HTTP integration cover documented paths. These do not establish distributed production consistency. |
| Hosted Netlify Blobs CAS, multi-instance races, deployed rate limiting and scheduled cleanup | BLOCKED | No hosted preview/production verification performed or authorized. Local Netlify Dev and mocked ETag stores are not substitutes. |
| Ordinary-device/mobile hardware performance and accessibility audit | IMPLEMENTED / UNVERIFIED | Responsive local Chrome screenshots and layout checks passed; physical-device performance, screen-reader operation and a complete keyboard-only audit were not measured. |

### Phase 29 changes and check results

- Corrected the real API integration test from the obsolete three-shot/damage expectation to the required one-valid-shot/one-destruction behavior. Added assertions for unaffected asteroids, exactly-once shared score, replay, cooldown and duplicate join; added live Navigator-mark authorization/synchronization coverage.
- Corrected the README launch-screen description to match the currently implemented full-screen local MP4 and poster fallback.
- `npm test`: PASS; 77 game-rule assertions and all configured suites.
- `netlify build`: PASS; bundled `cleanup-expired-rooms.js` and `game.js`.
- `npm run test:integration -- http://localhost:8888/.netlify/functions/game`: PASS against the already-running local Netlify Dev server; six sessions/roles, shared Gunner destruction/score, Navigator marking, room/chat/lifecycle and capacity cases passed. Timed result/rematch is covered by deterministic handler tests, not this normal-duration live round.
- Isolated Chrome/CDP two-client browser report above: PASS for the recorded checks, zero page/browser errors.
- Production deployment and multi-instance behavior remain unverified. No deploy, commit, push, reset, or production-data operation was performed.

## Phase 30 — authoritative Gunner projectile timing (2026-10-30)

The previous server handler destroyed the selected asteroid and awarded score as soon as FIRE was accepted; its client bolt was only a 165 ms cosmetic animation. Replaced that with a server-owned projectile in the existing flight state. Room mutation/poll ticks advance projectile positions with asteroid positions and swept relative-segment collision. FIRE records a launch event and sets the existing cooldown/contribution, but leaves the asteroid, score and destruction contribution unchanged. A confirmed selected-target collision consumes one projectile, removes one asteroid, publishes impact time/position, then awards +50 once. Completed projectile records retain bounded `active`/`destroyed` state so peers receive the impact status. Missed/expired projectiles do not affect asteroids or score. Public snapshots omit the shooter's private session ID.

Verification:
- Physics tests cover accepted launch with target alive, mid-flight state, confirmed hit, miss, one selected target, and a high-speed swept collision.
- API handler tests cover role/range/cooldown/replay, one projectile per request, live projectile synchronization, no pre-impact score/destruction, impact-only destruction and +50, and private shooter ID redaction.
- `npm run test:integration -- http://localhost:8888/.netlify/functions/game` passed against local Netlify Dev: the peer received the projectile and living target at score 0, then the target disappeared and score became 50 after server collision.
- Focused isolated Chrome/CDP two-client run passed and had zero browser errors. Both clients saw an active projectile with the target present and score unchanged; their timestamp-extrapolated positions differed by under 0.06 world units. After impact both saw removal and +50. Evidence: `test-artifacts/phase17b-2026-10-30T06-28-27-443Z/report.json`, `gunner-projectile-flight.png`, and `gunner-one-shot-destruction.png`.
- The full viewport browser harness also captured the projectile and passed the two-client impact/score assertions, but exited later when the short local round ended during the reverse viewport sweep; its viewport aggregate is not a pass. That run is `test-artifacts/phase17b-2026-10-30T06-18-53-344Z/report.json`.
- Final `npm test`, local Netlify build, JavaScript syntax checks and Git diff checks passed. Hosted Netlify multi-instance behavior remains unverified; nothing was deployed.

## Phase 31 — Pulse Cannon first-contact timing and speed (2026-10-30)

The configured projectile speed is now `0.6` world units/second (2.5× the previous `0.24`). Server collision uses the earliest swept-circle contact between each projectile segment and its selected asteroid's same-tick motion segment, including both radii. The projectile stops at that contact coordinate; only the confirmed impact removes the asteroid and awards +50. Client extrapolation invokes the same swept-circle calculation and clamps the visible bolt to the predicted contact, preventing a delayed snapshot from drawing the projectile beyond its target. Muzzle, cyan trail/head and debris remain tied to launch/projectile/authoritative impact state.

Verification evidence: `test-artifacts/phase17b-2026-10-30T16-12-11-109Z/report.json` records isolated local Chrome clients selecting a distant target at 56% range and then a nearby target at 13% range. The shooter received an active projectile while its target remained and score was unchanged; after impact both clients held the same impact event ID/time/coordinates, removed the selected target and synchronized the +50 score. Both shots passed with zero browser errors. Regression tests cover 2.5× speed, first contact, miss, high-speed tunneling, moving-target display clamp, one-time score/replay and peer impact synchronization. `npm test`, Netlify build, live local API integration, JavaScript syntax checks and `git diff --check` passed. Hosted multi-instance/production behavior was not tested or deployed.

## Phase 32 — Remove Gunner impact presentation lag (2026-10-30)

The authoritative flight tick already removed the asteroid and awarded score in the same `advanceFlight` update that returned its collision; tracing showed two surrounding timing issues. First, the FIRE action created the projectile before ticking the room, so the tick's accumulated elapsed interval could advance a newly launched shot through time before it existed. Projectile simulation now starts at `createdAt`, and the target's sweep interval is aligned to that launch time. Second, the impact burst was gated on comparing the client clock with `impactAt`; it now starts as soon as the authoritative destroyed event is applied and uses a nonnegative event age, so wall-clock skew cannot defer the effect. Stale snapshots remain rejected by monotonic match/round revisions. Current polling is 750 ms during live flight and 650 ms while a projectile is active, returning to 1.5 s in the lobby; failed polls back off up to 8 seconds.

Two-client Chrome evidence: `test-artifacts/phase17b-2026-10-30T16-21-21-332Z/report.json`. A distant 57%-range shot and nearby shot were fired. Both clients applied and drew the authoritative impact on the first frame after receiving its state update. For the distant shot, collision `impactAt` was 1793377286820.15; host received the event at 1793377286898 and drew it at 1793377286911 (13 ms after receipt, 91 ms after impact). Guest received at 1793377286919 and drew it at 1793377286929 (10 ms after receipt, 109 ms after impact). Both held the same event ID, collision time/coordinates, asteroid removal and score. Zero browser errors. Unit coverage now protects launch-time simulation, same-update collision, immediate event rendering despite clock skew, impact position and stale-snapshot rejection. Final test/build/syntax/diff results are recorded below after completion.
Phase 32 final verification: `npm test` passed all configured suites including poller, projectile launch-time, collision timing, renderer and stale-snapshot regressions; `netlify build` passed and bundled both functions; `node test/api.room.integration.test.js http://localhost:8888/.netlify/functions/game` passed; syntax checks passed for 43 JavaScript files; `git diff --check` and staged diff check passed. Active-match polling increases Netlify Blobs traffic while improving live synchronization. No production environment was accessed.
