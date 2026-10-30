# Signal Shift: Survive Together — Engineering Specification

Status: FINALIZED

## Objective

Audit and repair the existing browser-based multiplayer survival game as a cohesive application while preserving its identity, working behavior, and Netlify architecture. Prioritize the reported Netlify Blobs `uncachedEdgeURL` failure, reliable room creation and joining, multiplayer state integrity, complete gameplay, security, useful regression coverage, and accurate documentation.

## Constraints

- Preserve existing user changes and working functionality.
- Use the installed and documented Netlify/Blobs integration; never fabricate an endpoint or weaken strong consistency.
- Do not substitute in-memory persistence or introduce paid infrastructure without approval.
- Validate important claims with actual command/API/browser evidence.
- Do not deploy, publish, migrate production data, force-push, or commit without explicit authorization.
- Record infrastructure blockers precisely and continue independent safe work.

## Acceptance

- Identify the actual Blobs failure cause and verify a supported local store configuration through the real local endpoint when infrastructure permits.
- Verify room creation, joining, concurrency/capacity behavior, lifecycle, gameplay, and client error/loading states against actual code and available tests.
- Add meaningful regression coverage for confirmed defects.
- Report test commands/results and separate verified, partial, unverified, and blocked criteria.
- Update documentation to describe only implemented and verified behavior.
- Produce a release-readiness assessment; production deployment remains a separate approval-gated step.

## Phase 2 — Production-readiness acceptance

Continue without resetting or replacing Phase 1 work. Preserve all pre-existing and uncommitted changes. Reassess the current working tree before every implementation wave.

The Phase 2 work must:

- Document every room-key read-modify-write sequence, its strong-read and conditional-write behavior, and the limits of local testing. Do not mislabel a process-local lock as distributed coordination.
- Restore a player after refresh/network loss using the existing high-entropy player ID only as a bearer session token, verify it server-side, define expiry/revocation, and prevent stale requests from mutating a later match.
- Define and enforce lobby, active-match, results, and closed-room lifecycle rules, with safe cleanup that never removes an active match and is safe under concurrent invocations.
- Add serverless-appropriate abuse protection without introducing paid services or globally ineffective in-memory rate counters.
- Verify server-authoritative timed progression, end conditions, late/duplicate actions, rematch/reset behavior, and independent multiplayer sessions.
- Update operational documentation and report what was verified locally versus what still needs staging/deployment evidence.

Approval constraints: no production deployment, production-data mutation/deletion, database migration, paid infrastructure, credential change, repository publish, force push, or reset. Local test data and code/config changes are authorized; scheduled cleanup must remain unexecuted against production data in this task.

## Phase 3 — Cinematic cooperative flight

Preserve all Phase 1 and Phase 2 behavior and worktree changes while adding an original, locally rendered cinematic intro and an interactive asteroid-flight world. The browser renderer may animate continuously, but only host-authored input changes and server request ticks may mutate persisted flight state; never write per animation frame. The server owns ship position, asteroid positions, collisions, hull damage, and collision event IDs. The host is the sole flight controller for a match; all connected clients render the same authoritative ship and hazard state. Keep the existing room, session, lifecycle, validation, rate limiting, replay protection, abilities, timer, results, and rematch paths intact.

### Acceptance

- Intro has a skippable mission reveal and an original SVG/CSS warship over a layered procedural space scene; reduced motion and immediate Create/Join access are supported.
- A visible warship and a bounded field of moving asteroids render in the active-game canvas; the canvas resizes, pauses or caps extrapolation when hidden/offline, and does not start duplicate loops.
- Host WASD and arrow-key commands set a shared flight vector; form controls and non-host clients do not issue movement commands.
- Server ticks advance shared movement and asteroid state, detect swept collisions, apply bounded hull damage at most once per asteroid collision, and publish unique explosion events to all players.
- Deterministic unit tests cover movement, boundaries, asteroid motion, swept collision, hull damage, and explosion/event cleanup. API tests cover host authorization, match validation, duplicate input/event handling, and shared state.
- Existing tests, configured local build, syntax checks, diff checks, API checks, and browser verification are run where tools permit; report browser limitations honestly.

Design boundary: use original procedural CSS/SVG/canvas art, so this phase introduces no third-party art or audio licenses, network media dependencies, game engine, or paid service. Netlify Blobs remains one room key and all authoritative flight changes remain per-room CAS writes.

## Phase 10 — Shared-state rendering, room chat and premium palette (in progress)

Continue the existing client, Netlify Function and room-Blobs architecture. Investigate the Pilot visibility report against the actual sanitized snapshot and renderer; do not claim a root cause until reproduced. Every authorized client must receive and render the same authoritative ship and asteroid state. Add a deterministic Pilot-host/Navigator-guest regression if a role visibility branch is not present.

Room chat, if absent, uses the existing room mutation/storage and poll snapshots. Derive sender name from the authorized session; validate text and membership server-side, bound rate/history/replay receipts, isolate rooms, and render messages as text. Preserve existing lifecycle, gameplay and replay checks. Palette work uses shared forest/cream/gold tokens, with browser viewport checks reported separately from code/test evidence.

Acceptance status for this continuation: server snapshot parity regression and mocked handler chat coverage are implemented; shared palette tokens are updated. Active browser reproduction/two-client chat, viewport screenshots and hosted multi-instance Blob verification remain open. See `.gsd/ROADMAP.md`, `.gsd/STATE.md` and `.gsd/JOURNAL.md` for the evidence ledger.

## Phase 11 — Premium launch presentation and verification (in progress)

Continue the existing no-framework frontend, Netlify Function, and Blobs architecture. Improve the existing original inline SVG ship and CSS scene into a restrained 2.5D forest/cream/gold presentation. Preserve the live Create Room and Join Room handlers, responsive structure, keyboard focus, and reduced-motion support. Do not add a heavyweight 3D dependency or replace gameplay with decorative art. Recheck Phase 10 renderer/chat behavior with existing tests and browser evidence where available; keep mocked handler evidence separate from live two-client results.

Current implementation uses layered SVG hull/deck/underside geometry, metallic green shading, gold trim and identification lights, a dimensional engine/cockpit treatment, CSS perspective, planet/nebula/star layers, and restrained hover/idle motion. Structural tests check handler IDs/wiring, art layers, breakpoints and reduced motion. Browser screenshots across requested viewports and post-fix two-client gameplay/chat remain outstanding.

## Phase 14 — Cinematic landing visual (in progress)

The landing hero uses an original locally bundled photoreal 2D warship asset with meaningful alternative text, intrinsic dimensions and restrained CSS motion. Preserve the existing room creation/join handlers, audio and skip controls. The headline uses metallic text fill and layered CSS depth shadows; it is a 2D artwork presentation, not a real-time 3D model. Maintain the forest/cream/gold palette, mobile stacking and reduced-motion behavior. Require actual browser inspection for visual acceptance; automated markup tests alone are not screenshot evidence.

## Phase 3A — Gameplay visual and control repair

Keep the Phase 3 Canvas renderer and multiplayer authority. Remove gameplay-layer blur from the world canvas, scale the procedural ship for immediate recognition, preserve sharp high-DPI rasterization, and increase the silhouette, surface contrast, size variety, and rotation of the bounded asteroid set. Implement one explicit piloting model: W/Up thrusts, S/Down brakes/reverses, and A/D/Left/Right turn; authority remains with the room host. Apply acceleration, maximum speed, damping, and world bounds in the existing server-owned tick. Guests must see a clear pilot label. Late poll/action responses must not rewind a newer snapshot for the same match.

### Acceptance
- No gameplay UI backdrop blur is applied to the Canvas world; the Canvas backing size accounts for device pixel ratio and resizes when CSS dimensions or DPR change.
- Ship silhouette is larger, sharply outlined, metallic, directional, and remains a moving Canvas entity with active thrust/reverse feedback.
- Asteroid silhouettes are irregular, materially distinct in size/shape, detailed and rotating; spawning remains capped.
- Host control axes implement forward thrust, braking without reverse, steering, damping, max speed and boundaries authoritatively. Non-host controls remain denied and the UI identifies the current pilot.
- Snapshot revision prevents older same-match or prior-match poll responses from overwriting newer authoritative state.
- Unit/API tests, build, syntax checks, local integration and available browser inspection are recorded honestly. Active gameplay keys/pixels require interactive browser evidence.

## Phase 3C — Orientation and cooperative mission

Use screen coordinates (+X right, +Y down), native ship artwork forward on +X, and an initial heading of −π/2. Forward thrust, turn direction, renderer prediction and collision geometry must use the same model. S/Down brakes to zero speed without reversing. The normal-length shared objective requires survival, three resolved emergencies and ability contributions from two distinct players. A marked rogue asteroid is an actual approaching object that the Navigator can divert; Engineer repair is capped and a full-hull no-op is rejected. The server remains authoritative for mission progress and consequential state.

## Phase 3D — Hyperspace tunnel background

Replace only the ordinary starfield/planet backdrop with an original, animated monochrome tunnel effect: a deep central vanishing point, layered silver-white radial filaments, curved particle trails, restrained edge falloff, and motion tied subtly to authoritative ship velocity. Keep the ship, moving asteroids, collision flashes/debris, HUD, and multiplayer controls in their existing separate layers. Do not use the supplied social video unchanged; its reuse rights are undocumented and the browser sandbox rejected its local file URL, so frame-by-frame reference comparison remains outstanding. Add deterministic renderer coverage and inspect a live local gameplay viewport. No external media or license dependency is introduced.

## Phase 4 — Cooperative gameplay and mission results

Build on the existing authoritative mission, flight, roles, emergencies, lifecycle, and rematch paths. Navigator radar derives contacts only from live bounded asteroids and their relative trajectories; an authorized mark is tied to the active match, expires, and is shared. Pilot movement stays host-authoritative. Engineer abilities remain server-validated, cooldown-limited, capped, and consequential. A bounded shared crew feed and role contribution counters reflect successful events only. Results include a transparent score breakdown, survival, hull, emergency progress, and role contributions; rematches reset match-scoped state.

### Acceptance and evidence boundary
- Radar contacts, danger classes, marker expiry/match scoping, role checks, replay/cooldown, shared snapshots, successful contribution counters, feed bounds, and score arithmetic are covered by deterministic unit/API-handler tests.
- Two-client local browser verification confirmed the shared radar and a real Navigator mark/feed update, active game composition, shared hull/mission state, host movement/collision, and results. The manual round ended in defeat; repair was not exercised in that Phase 4 browser session, and rematch browser automation timed out. Engineer repair and result scoring are verified in API-handler tests; rematch reset and lifecycle paths retain earlier tests/browser evidence.
- The local API integration suite verifies room/session, host flight, replay, leave/host handoff, validation, and capacity. Hosted multi-instance storage, rate limiting, and scheduled cleanup remain deployment-preview checks. No production action is authorized by this phase.

## Phase 6 — Cinematic asteroid materials and physical destruction

Preserve the Phase 2–4 multiplayer architecture and monochrome tunnel. Use original seeded Canvas rock materials, cached per shape in a bounded client cache. The existing flight state is server-authoritative; asteroid health, match-scoped IDs, projectile validation, cooldown/replay protection, scoring, destruction, and ship collision damage stay on the server. Clients derive bounded, cosmetic particles from shared stable events; particles never collide or affect score. The previous Gunner `Counter Blast` resolved emergencies only and was not a pulse cannon, so this phase adds `Pulse Cannon` as a Gunner ability through the existing validated action route.

### Phase 6 acceptance and limits
- Procedural asteroids have irregular seeded silhouettes, directional mineral shading, craters, cracks, and persistent impact marks based on authoritative health. Their textures are cached once per seed in a 16-entry bounded cache; the live field remains capped at eight.
- Pulse Cannon selects a real asteroid in range from the current shared snapshot. Server validation enforces Gunner role, membership, active match, target existence/range, cooldown, and action replay protection. One accepted shot removes exactly the selected asteroid, regardless of its prior health; the same stable event carries match ID, hit point and destruction state to both clients. A destruction awards +50 combat score once; replayed, duplicate, unauthorized, out-of-range, cooldown-blocked, and destroyed-target requests do not score.
- Ship impacts publish localized contact coordinates and server-computed hull damage. Visual shock, hull-hit cue, pulse trails and cosmetic fragments are time-derived from shared events; they do not create gameplay state. Tunnel speed/parallax feedback derives from actual shared ship velocity, with reduced-motion handling.
- Deterministic physics, renderer-smoke, score, and mocked API-handler tests cover hit/range/replay/cooldown/role/damage/destruction/shared event/score and texture caching. Local HTTP integration covers the existing room/session/control/replay/handoff/capacity path, not a live Gunner role.
- Interactive browser verification was attempted using the visible local page; screenshot/accessibility state disagreed and Computer Use clicks failed to return a refreshed state. Do not claim active-game browser or two-client cannon verification for this phase. Mobile performance and hosted/multi-instance behavior are also unmeasured.

## Phase 7 — Six-player cooperative gameplay completion

This phase continues the same client, Netlify Function and room-blob architecture. Preserve session/lifecycle validation, replay receipts, shared snapshots, flight physics, room creation/join, results and rematches. Roles are independent server-authorized capabilities while `player.role` remains the primary label for compatibility.

### Role policy
- Two players: Pilot + Engineer; Navigator + Gunner.
- Three players: Pilot; Engineer; Navigator + Gunner.
- Four players: Pilot; Engineer; Navigator; Gunner.
- Five players add Power Systems Operator.
- Six players add Communications Officer.
- The host is Pilot because the host owns flight input; Gunner aim/fire is a separate pointer/touch selection and FIRE action.

### Gunner
- Select a visible in-range asteroid in the Canvas with pointer input, or use the accessible target list. The selected target has a visible Canvas reticle; the separate FIRE button submits the target ID.
- The server still checks room membership, active match, capability, current target, range, cooldown and replay receipt. One hit removes one of the standard asteroid's three health, and destruction/score/events remain authoritative and shared.
- Weapon power changes the authoritative shot cooldown. The renderer only draws bounded cosmetics from the shared event.

### Power Systems Operator
- The only accepted shares are integer engine, shield and weapon percentages from 0 to 100 whose sum is exactly 100. The state is shared and updated by the existing action route.
- Engine allocation scales authoritative acceleration from 0.55× to 1.45×. Shield allocation reduces collision damage by 0–30%. Weapon allocation scales the 1.8-second base cannon cooldown by 1.5× to 0.5×.
- Engine Overdrive consumes 30 points from a 100-point match reserve, lasts eight seconds, and has a 25-second server cooldown. Allocation and boost contributions are recorded.

### Communications Officer
- A six-player match gets a server-generated three-symbol sequence, four options, and a 30-second deadline. The server stores the answer index and does not expose it in public snapshots.
- Only the Communications Officer capability can submit an answer. Wrong and expired answers award nothing. A correct answer completes the task once and adds 100 to a separate communications score component.

### Evidence boundaries
- Regression tests cover exact assignments for 2–6, combined-role authorization, allocation validation and actual movement/damage effects, boost state/cost, communications answer secrecy/correctness/expiry/replay/reward, and renderer reticle draw calls.
- Local Netlify Dev HTTP integration uses six independently created player sessions in one room, starts the actual match, verifies all assigned role arrays and match IDs, rejects a seventh member, applies a Gunner hit, and reads reduced health from another session.
- Two interactive local browser sessions completed create/join/start. The Gunner selected a target and fired; the browser showed its health fall 3/3→2/3 and a cooldown, while the host received the shared Gunner event. The host also sent ArrowLeft and saw the Pilot steering event. Canvas/ship/asteroid/hull HUD were observed, including a 390×844 viewport.
- Power and Communications browser-specific interactions, actual touch hardware, six simultaneous browser windows, a complete six-player mission win, post-destruction browser reconnect/rematch, mobile frame rate, and production multi-instance Blobs/rate-limit/scheduled cleanup behavior remain unverified. Local deterministic/API or build evidence must not be reported as deployment or full-browser evidence.


## Phase 8 — Premium landing and Gunner controls

- Keep the existing multiplayer/backend architecture and Create/Join flows. The splash screen is a top identity/status bar plus two-column artwork/briefing layout on desktop, with a contained original ship illustration and its identifying caption outside the drawing; mobile stacks artwork before briefing/actions.
- The landing palette is restrained and tokenized. Focus is visible, reduced motion is respected, and page zoom remains available.
- The Gunner interface is visible only for the Gunner capability, including combined Navigator/Gunner. Pointer/touch selection and the accessible target list select actual current in-range asteroids. The separate FIRE button sends the selected target to the existing `App.onUseAbility` → API `player_action` path; client input cannot set damage/score. Pending requests suppress duplicate clicks; authoritative cooldown and match state still gate actions server-side.
- Regression coverage verifies UI event wiring alongside the existing server-handler authority tests. Live viewport and multiplayer browser observations must be reported separately from unit/API tests.

## Phase 9 — Gameplay scene resilience and event identity

- Keep Canvas as the authoritative-state renderer. The scene draws the space background even while ship/asteroid snapshots are delayed or invalid; it draws a ship only from a valid shared position and skips malformed rocks without mutating gameplay state.
- Keep rendering on the existing single requestAnimationFrame loop. Report a failed frame and continue scheduling; stop on game end and cancel the outstanding handle on exit/re-entry.
- Use one bounded extrapolation/coordinate helper for displayed asteroid positions and Gunner pointer aiming. Server range and damage checks continue to use authoritative state.
- Collision, pilot and ability activity/toast events carry stable match-scoped IDs. Repeated polls must not re-emit event toasts or duplicate crew-feed entries. Separate impact IDs remain separate events even when their messages match; visible toast count is bounded.
- Missing hull data is rendered as unknown, never zero. A valid zero hull shows a breach/synchronization state while the server's zero-hull rule transitions the room to results.
- Automated render/API tests must cover ship plus valid asteroids, empty/delayed asteroid arrays, malformed coordinates, extrapolation/pointer alignment, frame-loop recovery, repeated polling/event IDs, hull loss and server-authoritative Gunner damage. Browser checks must be reported separately; no user-facing scene restoration claim is made without active-match browser evidence.

## Phase 16 — Visual consistency and partial-snapshot recovery

- Treat the landing PNG as the cinematic poster, not a gameplay sprite. The active game uses the original isolated Canvas Wayfarer silhouette, sharing its forward axis and cream/forest/gold palette with the landing art.
- Invalid/missing ship coordinates must not short-circuit rendering of valid authoritative asteroids. A valid ship snapshot can be retained for up to three seconds for display only, scoped to its current match; a match change clears it. Do not mutate, submit, or substitute client physics for server-owned ship/asteroid state.
- Preserve the charcoal/forest atmospheric tunnel, cream/mineral asteroid material, gold engine light, and restrained cyan shielding/target cues. Keep background draw before world entities and keep the ship foreground above impacts/weapon visuals.
- Tests must verify background/entity order, real ship prediction, actual asteroid texture blits despite invalid ship state, bounded same-match ship grace, match reset, resize recovery, optional texture-context fallback, and no renderer mutation. Local API parity/movement/Gunner evidence and real browser pixel evidence remain separate acceptance classes.

## Phase 17/18 acceptance updates

- Responsive Canvas regression coverage uses injected viewport sizes of 360×800, 390×844, 768×1024, 1366×768, 1920×1080 and 2560×1440, with varying DPR. It asserts backing-buffer scaling, measured-container resize recovery, normalized ship placement, and valid ship plus asteroid rendering. This is automated renderer evidence only; the specific reported wide-screen black-scene cause still requires a trustworthy live active-match reproduction.
- Landing requirements: remove the mission briefing's card frame and background, retain legible text and accessible controls, animate the original Wayfarer with restrained two-axis drift and slight banking, and honor reduced motion. Keep all existing room, audio, skip-intro, game, and multiplayer paths intact.
- Browser viewport screenshots, visual quality, real resize, live interactions, and independent-client visual parity must be documented separately from source tests and API tests.

## Phase 26 — Full-bleed landing video acceptance

- This phase supersedes the earlier two-column landing-artwork layout description: the video is now the scene background, with existing title/briefing/actions composed above it.
- The existing single Wayfarer video is mounted directly in the splash as a full-viewport background layer with `object-fit: cover`, behind all content and pointer-transparent. No framed video stage or duplicate video element remains.
- Preserve the existing MP4, poster fallback, muted/autoplay/loop/inline behavior, reduced-motion and inactive-screen pausing, audio toggle, Skip Intro, fleet/distress identity, title, mission briefing and Create/Join controls.
- Keep a restrained dark forest overlay for legibility and retain keyboard focus styles. The background must not introduce horizontal scrolling, overlap or video layout shift.
- Browser acceptance uses actual local browser captures and viewport measurements at 375×812, 768×1024, 1024×768, 1440×900 and 1920×1080. Report landing evidence separately from unrelated gameplay checks, full clip loop-wrap/device performance, six-client behavior and production/deployed behavior.

## Phase 27 acceptance: remove the decorative planet circle

The large bottom-left circle was the splash `.splash-planet` element and its unique CSS styling. It is removed, with other `.splash-cosmos` layers preserved. Regression/browser checks confirm the element remains absent and the video is exposed underneath across mobile, laptop and desktop sizes.

## Phase 28 acceptance: remove floating landing spheres

Remove all three landing-only `.splash-asteroid` decorative sphere nodes and their dedicated style rules. Preserve gameplay asteroids and all other landing video, atmospheric effects, layout, content and control behavior. Confirm absence in source and real-browser viewport captures.
