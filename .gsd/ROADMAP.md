# Engineering Roadmap

## Milestone A — Baseline and architecture discovery
- [x] Inspect repository, instructions, package scripts, Git state, app modules, tests, and Netlify configuration.
- [x] Run configured baseline test command and capture original user changes.
- [x] Reproduce the Blobs error through Netlify Dev and capture real endpoint evidence.
- [x] Record module responsibilities and key release risks in the engineering notes.

## Milestone B — Critical backend recovery
- [x] Upgrade the local Netlify CLI and Blobs SDK to versions that provide the required strong consistency context.
- [x] Preserve complete runtime context, including uncached edge URL, rather than synthesizing endpoint values.
- [x] Verify room create, persisted join, invalid code and state reads through the local endpoint.
- [x] Add a real API integration suite and local-dev store regression coverage.

## Milestone C — Multiplayer correctness
- [x] Audit ETag conditional writes and verify missing production ETags fail closed.
- [x] Reproduce and fix the local sandbox's missing-ETag final-slot join race using a per-room local-dev serialization queue.
- [x] Verify simultaneous final-slot joins result in one success, one rejection and six persisted players.
- [ ] Complete reconnect, host lifecycle, room expiry and deployed-provider concurrency review.

## Milestone D — Complete gameplay
- [x] Verify start-game transition and an authoritative in-game action through the real local endpoint.
- [ ] Complete timed emergency resolution, win/loss and rematch API coverage.

## Milestone E — Frontend and player experience
- [x] Browser-smoke the landing, nickname and lobby screens against local Netlify Dev.
- [x] Send polling reads through POST so player session IDs do not appear in query strings.
- [x] Suppress stale poll results after a room/session transition.
- [ ] Complete broader responsive, reconnect and gameplay UI interaction review.

## Milestone F — Security and resilience
- [x] Add request method, content type, JSON shape, payload size, nickname, room code, session ID and action validation.
- [x] Require room membership for state reads and verify outsider access rejection.
- [x] Replace weak random ID generation with cryptographic random APIs.
- [ ] Complete rate limiting, abuse controls and deployment-level threat review.

## Milestone G — Quality assurance
- [x] Run configured test suite and real local API integration suite.
- [x] Review whitespace errors and final working tree status.
- [ ] Expand long-duration, multi-instance and browser responsive coverage.

## Milestone H — Release preparation
- [x] Update setup, local storage, Node/CLI and integration-test documentation.
- [x] Record environment requirements and unresolved production storage caveat.
- [x] Produce an evidence-based readiness report. No deploy, publish or commit performed.

## Baseline (2026-10-28)
- Git branch `main`, ahead of `origin/main` by one commit.
- Existing work at start: modified `netlify/functions/game.js`; untracked `test/store.dev.test.js`. Both were preserved.
- `npm test`: 44 game-rule checks plus production store, sanitize and writeRoom checks passed.
- Existing `test/api.integration.test.js` was not included in the configured `test` script.
- Netlify CLI 17.38.1 and Blobs 8.2.0 lacked a complete local strong-consistency context. The first local create call failed with `BlobsConsistencyError` because `uncachedEdgeURL` was absent.
- Production deployment and Git publishing were not attempted.

## Phase 2 — Production readiness (planned 2026-10-28)

### Wave 1 — Confirm architecture and baseline
- [x] Re-read specification, current state, project rules, tests, function, game rules, client API/poller, package and Netlify config.
- [x] Confirm current branch/status and preserve the Phase 1 worktree.
- [x] Re-run `npm test` before Phase 2 implementation.
- [x] Verify Netlify Blobs strong reads, atomic conditional writes, expiration and rate-limit capabilities using current official docs and installed SDK.

### Phase 2 design decisions
- Per-room production state is one Blobs key. Strong reads plus documented atomic `onlyIfMatch`/`onlyIfNew` writes protect a single-key compare-and-swap. There is no multi-key transaction; current game actions touch one key, so no database migration is proposed unless staging proves CAS contention or behavior inadequate.
- Use existing generated player IDs as bearer tokens, persisted in tab `sessionStorage` for refresh/network restore, with a 24-hour idle expiry. The server must confirm room membership and session age; explicit lobby/results leave removes membership and revokes that token.
- A lobby remains live while valid players poll and expires 24 hours after its latest activity. Results remain available for 24 hours. Closed room records remain for one hour before scheduled deletion. Active matches are never deleted; cleanup after the 90-second deadline plus 10-minute grace finalizes them, then starts the 24-hour results retention.
- Host remains stable during ordinary brief disconnects. After the existing 10-second offline threshold in lobby/results, the earliest connected member becomes host; explicit host leave transfers immediately. During play, disconnected membership stays in the match.
- Netlify path/IP rate limit target: 300 requests per 60 seconds, giving six players polling every 1.5 seconds (about 240/minute from one shared IP) headroom for actions. Netlify enforcement can lag and is not a hard global limit; verify in a deploy preview before release.
- Add match IDs and per-round bounded action receipts to reject stale-match and same-request replays. No external service or credentials are introduced.

### Wave 2 — Safe state/session lifecycle
- [x] Add documented session restore/reconnect and server validation with idle expiry.
- [x] Add explicit leave semantics and deterministic host handoff for lobby/results.
- [x] Add room expiration states and scheduled cleanup; use per-room conditional writes and never remove an active match.
- [x] Add match identifiers, stale-action rejection and duplicate-action replay protection.

### Wave 3 — Abuse and gameplay integrity
- [x] Add native Netlify function rate limiting with a threshold that accommodates six players polling every 1.5 seconds; document per-IP/NAT and delayed-enforcement limits.
- [x] Fix connected-player start/rematch eligibility and actions arriving after the authoritative timer ends.
- [x] Expand deterministic game-rule and API integration tests for timeout, disconnect/reconnect, late actions, results, rematch, expiry, invalid/expired sessions and normal versus excessive traffic.

### Wave 4 — End-to-end verification and readiness
- [x] Exercise two independent browser sessions through lobby, play, reconnect, leave and rematch.
- [x] Re-run all supported tests, local API integration, syntax checks, Netlify build/config validation and final diff checks.
- [x] Document production requirements, storage guarantees, cleanup behavior and a staging multi-instance verification procedure.
- [x] Report unresolved production risks without deploying or modifying production data.

### Phase 2 release gate
- Local implementation and verification are complete. Production readiness remains conditional on a deploy-preview validation of native rate-limit configuration, scheduled cleanup invocation, and multi-instance Blobs CAS behavior. No deployment or production data access was performed in this phase.

## Validation (2026-10-28)
- Current installed versions: Netlify CLI 27.15.0, `@netlify/blobs` 11.1.7, Node 24.13.0.
- Local `npm run dev -- --port 18888 --staticServerPort 18999 --functions-port 18998` started successfully. This environment required alternate ports.
- Real API integration passed create, join persistence, invalid room and code handling, malformed body/content type/nickname checks, outsider rejection, start game, `patch_hull`, concurrent capacity race and final persisted capacity.
- Browser smoke reached the launch, nickname and lobby screens and returned to launch after leaving the test lobby.
- `npm test` passed 44 game-rule checks plus production store, sanitize and ETag write checks.
- `git diff --check` reported no whitespace errors (only Git's line-ending conversion notices).
- Phase 2 full API handler and lifecycle tests use deterministic clocks and mocked ETag storage; these validate logic, not hosted Blobs behavior.
- Local HTTP integration passed using Netlify Dev's sandbox Blobs store. It includes reconnect, gameplay/action replay, timed results, rematch, leave/host transfer, input validation, and concurrent room capacity.
- Two-tab browser smoke verified refresh recovery in lobby and active play, synchronized action effects, timed results, rematch, and leave. Browser error log was empty.
- `netlify build` bundled both the game and hourly cleanup functions. This is a local build check; hosted schedule/rate-limit post-processing was not exercised.
- Syntax checks passed for changed runtime and test JavaScript; `git diff --check` passed.
- Remaining release gate: verify per-key CAS under deployed multi-instance load, native rate limiting, and scheduled cleanup on a deploy preview before launch. Netlify enforcement may lag, and if every player stops polling during a match, scheduled cleanup may finalize the result up to roughly one hour after the match cleanup deadline.

## Phase 3 — Cinematic cooperative flight (2026-10-28)

### Milestone 1 — Baseline and roadmap
- [x] Inspect current status and preserve Phase 2 edits/untracked files.
- [x] Re-read specification, roadmap, current state, journal, README, package scripts, current frontend and server game rules.
- [x] Run `npm test` and `netlify build` before editing.
- [x] Reuse the healthy local server and inspect the current browser accessibility view; screenshot capture was unavailable, so no pixel-level visual claim is made.
- [x] Record the current visual/gameplay gap and Phase 3 acceptance in GSD.

### Milestone 2 — Cinematic introduction
- [x] Build a skippable, reduced-motion-aware mission intro with an original procedural space scene and visible original SVG warship.
- [x] Preserve direct, immediate Create Room and Join Room access and the existing name/lobby flow.
- [x] Build, run unit tests, inspect the browser accessibility tree, and fix regressions; browser screenshot inspection remains unverified.

### Milestone 3 — Shared flight model and deterministic tests
- [x] Add pure deterministic flight helpers for ship movement/bounds, asteroid lifecycle, swept collision, damage cooldown, and bounded effects.
- [x] Add tests for movement controls, boundaries, asteroid limits/motion, collision and one-hit damage/event cleanup.
- [x] Integrate shared state creation, advancement and collisions into the existing authoritative game tick and rematch initialization.
- [x] Run unit and API tests after authoritative integration; configured Netlify build ran with the combined game-world milestone.

### Milestone 4 — Gameplay canvas and controls
- [x] Add a responsive layered canvas world with visible warship, engine thrust/damage/shield cues, varied procedural asteroids, impacts, explosions and debris.
- [x] Implement one animation loop with delta-time extrapolation, visibility handling, resize support, reduced effects and cleanup.
- [x] Add host-only WASD/arrow-key flight input; guard editable elements, blur, visibility, lobby/results and stale match callbacks.
- [x] Render server-owned collision events consistently for all clients; do not persist animation frames.
- [x] Build, test, inspect the live launch page and API flow, fix issues, and repeat within a 12-iteration work-session bound. Active-game canvas interaction remains unverified in browser.
- [ ] Use an interactive browser session to enter a room and verify active gameplay pixels, actual key presses, and the same visible collision/explosion on two clients. Current browser surface only exposed launch-page accessibility and no screenshot/click path.

### Milestone 5 — Regression and owner review
- [x] Test host control authorization, duplicate command/event protection, collision damage synchronization, reconnect, game end and rematch reset.
- [x] Run `npm test`, local API integration, `netlify build`, syntax checks and `git diff --check`.
- [x] Inspect the live launch-page accessibility view; record active gameplay visual and input as unverified because browser interaction/screenshot access was unavailable.
- [x] Update README, GSD state/journal and criterion-by-criterion evidence; no deploy, commit, push, or production data operation.

## Phase 3A — Visual clarity and responsive flight controls (2026-10-28)

### Milestone 1 — Diagnose and repair the canvas presentation
- [x] Preserve existing Phase 2 and Phase 3 work; inspect the renderer, controls, CSS, server validation and test fixtures.
- [x] Remove gameplay-panel backdrop blur that was softening the world canvas underneath the panels.
- [x] Enlarge and sharpen original vector ship geometry; add device-pixel-ratio-aware backing dimensions and robust resize checks.
- [x] Enlarge and vary procedural asteroid sizes while retaining their fixed spawn cap and independently seeded surface geometry.
- [x] Validate drawing path, DPR scaling, deterministic asteroid variety, tests and local build.

### Milestone 2 — Repair the piloting model and shared snapshot path
- [x] Implement host-only forward thrust, braking without reverse, steering, acceleration, maximum speed and damping in the authoritative flight tick.
- [x] Add braking and engine-thrust cues and clarify the active pilot in the HUD for host and guests.
- [x] Expose the authoritative round revision and ignore older same-match poll/action responses.
- [x] Make RAF loop start/stop idempotent and test re-entry/reconnect to prevent duplicate gameplay render loops.
- [x] Test control mapping, acceleration, speed cap, damping, steering, bounds, host authorization, poll state and existing collision/damage events.
- [x] Run configured tests, Netlify build, syntax checks, local API integration and diff checks.
- [ ] Finish browser control coverage for S/Down braking, left steering and sustained movement. Two-tab browser play did verify the active Canvas, host movement/rotation, shared hull/mission display, collision effect, Engineer repair, Navigator course buff, and rematch reset; full 90-second survival and every key remain unverified.

### Milestone 3 — Evidence and readiness boundary
- [x] Update control/render docs and record local results in State and Journal.
- [x] Preserve the existing room/session/lifecycle/rate-limit/replay/rematch and Blobs design.
- [x] Do not deploy, commit, push, or modify production data.

## Phase 3C — Orientation and cooperative mission (2026-10-28)

### Milestone 1 — Align physics and rendering
- [x] Document screen coordinates and the ship artwork's native +X forward axis; use one heading for thrust, turning and drawing.
- [x] Make client extrapolation use the same deterministic ship step as the authoritative server.
- [x] Make S/Down brake without reversing and align HUD/README language to implemented physics.
- [x] Add tests for heading, thrust direction, steering, braking, prediction parity and bounds.

### Milestone 2 — Shared cooperative objective
- [x] Add a server-owned objective requiring three resolved emergencies and two distinct ability contributors on normal-length matches; short test rounds keep zero thresholds.
- [x] Mark an actual bounded asteroid for the guaranteed rogue-asteroid emergency; Navigator diversion removes it from its intercept path and broadcasts a real effect.
- [x] Validate Engineer repairs, cap hull at 100%, reject unnecessary full-hull repairs, and emit truthful repair/emergency messages.
- [x] Surface shared objective, outstanding emergency count, next threat, pilot identity, role state and authoritative recent actions in both clients.
- [x] Test authorization, shared mission progress, hazard diversion, repair/no-op behavior, and identical mission views for both players.

### Milestone 3 — Rematch ordering and verification
- [x] Keep authoritative revisions monotonic across match boundaries and reject delayed previous-match polls/results.
- [x] Run full unit suite, local Netlify build, syntax checks, local API integration and diff validation.
- [x] In two in-app browser tabs, create/join/start a local match; inspect active canvas, roles, objective, ship/asteroids, steering, impact/damage, Navigator buff, Engineer repair feedback and fresh rematch state.
- [ ] Browser-verify S/Down braking, sustained movement in all directions, a live marked-asteroid diversion, and exact same-frame host/guest visuals. These checks remain open; no production or multi-instance verification was performed.

## Phase 3D — Hyperspace background (2026-10-28)

- [x] Preserve the Phase 2/3 worktree and re-read the current specification, roadmap, state, journal and renderer.
- [x] Replace the flat blue starfield/planet layer with original seeded animated monochrome tunnel filaments and curved silver-white particles; retain the existing gameplay foreground and authoritative model.
- [x] Add renderer assertions for the dense filament/trail drawing path; focused renderer smoke passed.
- [x] Run local two-player browser play; confirm the tunnel, sharp ship, asteroids, HUD and an authoritative collision/hull update are simultaneously visible.
- [ ] Inspect several frames of the supplied video and compare against its actual motion/composition. Browser policy rejected its local file URL; rights and detailed visual similarity therefore remain unverified.
- [x] Re-run full `npm test`, Netlify build, JavaScript syntax checks, and `git diff --check` after final edits; all passed.
- [x] Inspect gameplay composition after the brightness adjustment: the ship, asteroids, HUD and collision state remained legible over the tunnel.
- [ ] Measure gameplay frame rate on the available browser; its page-evaluation scope did not expose the timing API, so performance was not measured.

No third-party visual asset was added. The supplied clip is not embedded or modified. No deployment, commit, push, production data change, database migration, reset, or cleanup was performed.

## Phase 4 — Cooperative gameplay and mission results (2026-10-28)
- [x] Audit current mission, movement, emergency, ability, scoring, rematch and multiplayer authority before changing behavior.
- [x] Derive a compact Navigator threat radar from actual nearby asteroid positions and relative trajectories; share the same sanitized contacts and match-scoped, expiring marker with both players.
- [x] Add server-validated Navigator marking with role, membership, active-match, asteroid/range, replay and cooldown checks; marking alone does not award an ability contribution or avoidance bonus.
- [x] Add a bounded shared crew-event feed sourced from successful authoritative events and role contribution counters reset per match.
- [x] Include survival duration, hull, emergency and rapid-response points, exact score breakdown, and role contributions in results.
- [x] Test radar risk derivation/expiry, marking authorization and replay, shared feed/radar, contribution accounting, repair validation, and score arithmetic.
- [x] Two-client browser check: create/join/start, shared Navigator mark and feed, Pilot-visible threat, live gameplay, and defeat result/role contribution display.
- [ ] Browser-verify Engineer repair during this Phase 4 session, a successful full mission, and rematch via interactive browser; the rematch automation timed out and this session ended before repair. Repair/scoring and rematch reset have deterministic handler/regression coverage; earlier Phase 3C browser run verified repair and rematch reset.
- [x] Local integration, full tests, build, syntax and diff checks passed; details and limits are recorded in State/Journal.
- [ ] Production/multi-instance Blobs CAS, scheduled cleanup invocation, and hosted rate-limit enforcement remain deployment-preview verification; no production change was made.

## Phase 6 — Cinematic asteroids and physical destruction (2026-10-28)
- [x] Inspect the existing Canvas renderer, authoritative flight model, Gunner ability definitions, action validation, event snapshots, scoring, tests and working-tree state before edits.
- [x] Replace the flat rock fill with original seeded irregular rock materials: directional volume, mineral mottling, crater pits/rims, fractures, rim light and bounded seed cache; preserve the monochrome tunnel and capped field.
- [x] Add authoritative asteroid health and a role-gated Gunner Pulse Cannon using the existing action endpoint. Server checks current match, actual asteroid/range, cooldown and duplicate receipt; three hits destroy, score once and emit stable match-scoped weapon events with the actual surface hit point.
- [x] Render persistent hit cracks, localized pulse muzzle/trail/impact, debris fragments, collision contact flash/shock and hull-hit feedback as bounded client cosmetics. They never alter gameplay.
- [x] Tie tunnel streak/parallax rate to the authoritative ship velocity and honor reduced-motion preference for the environmental layer.
- [x] Add physics, renderer cache/effect, score breakdown, and API-handler regressions for authority, health, range, duplicate/cooldown, shared events and one-time score.
- [x] Full tests, local Netlify build, JavaScript syntax checks, `git diff --check`, and local API integration passed.
- [ ] Inspect active Phase 6 gameplay and cannon impacts in two independent browser sessions; Computer Use showed the old splash/result page and input did not return an updated browser state. No screenshot claim is made for the active game.
- [ ] Verify mobile frame rate/performance and test reconnect/rematch specifically after asteroid destruction; deterministic rematch reset tests exist, but active browser and mobile evidence are unavailable.
- [ ] Production multi-instance Blobs, hosted rate limiting, and scheduled cleanup remain deploy-preview checks. No deploy/commit/push/production data operation.

## Phase 7 — Six-player roles and consequential Gunner gameplay (2026-10-28)

### Milestone 1 — Role capability model and Gunner console
- [x] Preserve existing legacy primary-role fields while assigning explicit server-owned capability arrays for the requested 2–6 player policy.
- [x] Render combined-role responsibilities and resolve emergency/mark/ability authorization from capabilities.
- [x] Replace nearest-auto-target Pulse Cannon UI with click/touch-capable aim selection, an explicit target list with health/range, visible selected reticle, and separate FIRE control.
- [x] Preserve server role/match/target/range/cooldown/action-replay checks and shared damage/destruction/score event handling.
- [x] Add role-policy, combined permission, renderer-reticle and six-session API regressions.
- [x] Verify two independent browser tabs create/join/start, show the combined Navigator/Gunner station, fire at a selected target, show 2/3 asteroid health and cooldown, and show the Gunner event to the host; exercise ArrowLeft and observe the authoritative Pilot steering event.

### Milestone 2 — Power and Communications roles
- [x] Add server-validated 100-point engine/shield/weapon power allocation; engine allocation affects acceleration, shield allocation reduces collision damage, and weapon allocation changes cannon cooldown.
- [x] Add a finite reserve-cost Engine Overdrive ability with an eight-second effect and server cooldown.
- [x] Add one server-generated 30-second symbol-sequence task for the Communications Officer; keep the answer index private, reject incorrect/expired tasks, and award exactly +100 communications score once.
- [x] Add role-specific UI, shared state, bounded result contributions and score components; cover authorization, invalid allocation, gameplay effect, task expiry/replay and scoring in deterministic API tests.

### Milestone 3 — Evidence, documentation and remaining checks
- [x] Verify six separate authorized player identities in one local Netlify Dev room; start the match, assert the exact six-role assignment, reject player seven, fire a Gunner shot, and confirm asteroid health through another session.
- [x] Verify active gameplay at desktop/browser default and a 390×844 responsive viewport; reset the temporary viewport after inspection.
- [x] Update README and GSD with exact controls, role policy, power and communications rules, test evidence and limitations.
- [ ] Verify Power Operator and Communications Officer controls in interactive browser sessions; their validation/gameplay and synchronized state are tested through mocked API handlers, but browser role-specific interaction is not yet observed.
- [ ] Verify touch-device aim/fire on actual touch hardware; browser pointer/click controls and mobile-sized UI were checked, but no touch hardware was available.
- [ ] Verify full six-client browser play, a complete mission victory and post-destruction reconnect/rematch in the browser; local HTTP integration confirms six sessions/roles/Gunner state, and deterministic handler tests cover rematch reset, but these extended browser scenarios remain unverified.
- [ ] Production multi-instance Blobs CAS, hosted rate-limit enforcement, and scheduled cleanup invocation remain deploy-preview checks.

No production deployment, commit, push, database migration, or production-data change was performed.

### Latest continuation validation — 2026-10-28
- `npm test` passed: 75 game-rule assertions and all configured suites.
- `netlify build` passed and bundled `game.js` plus `cleanup-expired-rooms.js`.
- All 28 JavaScript files under `js`, `shared`, `netlify/functions`, and `test` passed `node --check`; `git diff --check` passed (Git emitted only CRLF normalization notices).
- The most recent earlier local API integration remains the successful evidence for six sessions, role assignment, Gunner damage synchronization and player-seven rejection. The attempted rerun was blocked: a fresh Netlify Dev could not bind its default internal `::1:3999` listener (`EADDRINUSE`) even when alternate public/functions ports were requested.
- A six-tab browser lobby displayed 6/6 players, but clicking launch did not transition to gameplay. Do not count this attempt as six-client browser verification. The host-handoff role assignment is covered by the new regression test.

## Phase 8 — Premium landing screen and Gunner interaction audit (2026-10-29)

### Milestone 1 — Landing hierarchy and accessibility
- [x] Preserve existing room creation/join action IDs and screen state transitions.
- [x] Place the original SVG ship in a bounded illustration stage with an independent vessel caption; separate top identity/status and mission/action card into a responsive grid.
- [x] Add restrained landing palette tokens, focus treatment, reduced-motion behavior, and viewport zoom support.
- [x] Add desktop, tablet, and compact mobile breakpoints for the required 1920×1080, 1440×900, 1280×720, 768×1024 and 390×844 targets.
- [x] Inspect 1920×1080, 1440×900, 1280×720, 768×1024 and 390×844 in the live local browser; screenshots showed the ship contained, mission/actions visible and the compact layout stacked without visible overlap or clipping.

### Milestone 2 — Gunner interaction verification
- [x] Isolate target selection and FIRE UI wiring into a single-listener Gunner console module without changing the server action or authority model.
- [x] Show explicit role/weapon labels, mouse/touch aim instructions, target health/range, accessible target naming, pending-fire feedback, server cooldown, and role/match-gated FIRE callback.
- [x] Add UI wiring regressions for combined-role visibility, touch pointer aim, unauthorized access, selected asteroid request ID, pending duplicate suppression, cooldown and match reset.
- [x] Retain real handler tests for authorization, target/range, cooldown, replay, destruction and one-time score; UI module stubs do not count as API integration.
- [ ] Re-run real local two-client browser testing after refactor; Netlify Dev internal port issue is documented in State/JOURNAL.

### Milestone 3 — Regression, browser QA and records
- [ ] Full test suite, configured Netlify build, all-JS syntax check and diff check after final edits.
- [x] Live browser checks for the Create Room flow and five required viewport sizes; Create Room reached the real one-player lobby with a generated code and correct waiting/disabled-launch state.
- [ ] Complete a post-refactor two-client browser Gunner match to verify target selection, firing, and host-side synchronized damage. UI module regressions and local six-session API integration pass, but this browser sequence is still outstanding.
- [ ] Update evidence and limitations after final verification.

No deploy, commit, push, production setting/data change, or destructive Git action is permitted in this phase.

## Phase 9 — Gameplay rendering and notification repair (2026-10-29)

### Milestone 1 — Scene, loop and coordinates
- [x] Ensure scene background renders with delayed/empty asteroid state; draw valid shared ship and valid shared asteroids, skip malformed entities safely, and retain procedural asteroid fallback.
- [x] Keep the existing single animation loop alive after a reported transient frame error; preserve match-end stopping and cleanup.
- [x] Share bounded asteroid extrapolation and CSS pointer-to-world mapping between renderer and Gunner aim.
- [x] Add render tests for authoritative ship/asteroid draw, empty list, malformed coordinates and invalid ship state.
- [ ] Verify active-match scene recovery and visible ship/asteroids in a live browser match; current local Netlify Dev restart is blocked by internal port `::1:3999` (`EADDRINUSE`).

### Milestone 2 — Idempotent shared events and hull display
- [x] Assign stable match-scoped IDs to collision, pilot, Navigator and action activity records; deduplicate stable crew-feed IDs.
- [x] Process repeated collision snapshots once per event ID, cap toast stack to three and seed the ledger on match entry to avoid replaying stale impacts after reconnect.
- [x] Keep distinct impact IDs distinct even when text/damage amount are identical.
- [x] Render missing hull as unknown and zero hull as breach/results-syncing; retain server zero-hull transition to results.
- [x] Add deterministic repeated-poll, collision and action replay tests.
- [ ] Verify toast presentation and hull/phase synchronization in an active browser match.

### Milestone 3 — Final verification
- [x] Full test suite, Netlify build, all-JavaScript syntax check and diff check.
- [x] Update evidence in `.gsd/STATE.md`, `.gsd/JOURNAL.md`, and README with actual verification and limitations.
- [ ] Active two-client browser verification of scene, Pilot movement, Gunner fire, impact toasts and zero-hull transition.
- [ ] Identify the local `::1:3999` listener before any attempt to stop it; do not terminate unidentified processes.

No deployment, commit, push, production setting/data change, or destructive Git action is permitted in this phase.

## Phase 10 — Rendering parity, room chat, and premium palette (2026-10-29)

### Milestone 1 — Pilot/crew shared rendering evidence
- [x] Inspect role-specific render conditions and the sanitized snapshot. `SpaceRenderer` has no role visibility branch; members receive the same `round.flight.ship` and asteroid list.
- [x] Capture the active blank scene and its DevTools console. Root cause: `UI._rafTick` passed undeclared `_selectedAsteroidId` into the renderer, throwing `ReferenceError` before each scene draw.
- [x] Replace the undefined name with the actual selected target from `GunnerConsole.getSelectedTarget()` and add regression coverage for that render-loop selection wiring.
- [x] Add API regression coverage that the Pilot host and Navigator guest receive identical authoritative ship and asteroid snapshots.
- [ ] Recheck a fresh active match in the browser after the fix, from both host/Pilot and guest clients; the reproduced browser session ended in results and post-fix interaction was interrupted.

### Milestone 2 — Authorized multiplayer chat
- [x] Add a room-scoped `send_chat` action to the existing Netlify game function and Blobs room record; retain bounded history (100), bounded recent replay receipts, normalized 500-character input, server-derived sender and per-player 5/10-second rate window.
- [x] Include chat history only in a member's sanitized room snapshot; existing polling delivers it to room members. Add a compact panel for lobby/game/results with Enter send, persistent unread count, safe text-node rendering and mobile layout.
- [x] Handler regression tests cover submission, empty/long rejection, non-member rejection, same-room readback, room isolation, replay, rate limit and history bound.
- [ ] Browser-test two independent clients, panel focus/open/close/unread, mobile send, reconnect history and room isolation.
- [ ] Verify atomic chat writes and request rate enforcement in a hosted multi-instance preview; mock-store tests do not prove distributed Blobs behavior.

### Milestone 3 — Palette and final regression
- [x] Shift global and landing design tokens toward deep forest, cream, muted text and gold accents; preserve semantic danger/success colors.
- [ ] Inspect all screens at 1920×1080, 1440×900, 1280×720, 768×1024 and 390×844 after the palette change; active gameplay/browser screenshot unavailable this turn.
- [x] Full configured test suite and Netlify build pass after the implementation; final syntax/diff evidence is recorded in State/JOURNAL.

Production deployment and data changes remain prohibited. No commit or push.

## Phase 11 — Premium 2.5D landing and full verification (2026-10-29)

### Milestone 1 — Premium launch visual
- [x] Preserve the existing inline SVG warship and split landing composition; do not add a 3D library.
- [x] Add layered metallic top planes, darker underside extrusion, cockpit depth, gold trims, identification lights, soft engine glow and drop-shadows for an original 2.5D carrier presentation.
- [x] Recolor the atmospheric planet, nebula, stars, showcase grid, header and briefing surfaces to match forest green, cream and muted gold.
- [x] Add restrained pointer-hover perspective, primary/secondary button feedback and reduced-motion overrides.
- [x] Add a structural landing test confirming the real Create/Join IDs and event handlers, vector artwork layers, palette, responsive breakpoints and reduced-motion CSS.
- [ ] Visually inspect the landing page at 1920×1080, 1440×900, 1280×720, 768×1024 and 390×844; native browser interaction was unavailable during this turn.

### Milestone 2 — Existing gameplay and chat revalidation
- [x] Recheck the previous Pilot render crash fix, chat authorization/rate/history/dedup, Gunner UI wiring and role snapshot parity with existing regression tests.
- [ ] Run a fresh live two-client Pilot/guest match, chat send/reply, Gunner fire and reconnect/rematch in browser contexts.
- [x] Verify live Netlify Dev API integration for two-way chat/order/rate/isolation, six-session roles, Gunner cooldown/replay/damage/destruction/score synchronization, lifecycle, and capacity. Browser-based client flow remains open.
- [ ] Hosted/multi-instance Blobs atomicity and rate enforcement remain deployment-preview verification, with no production changes authorized.

### Milestone 3 — Final checks and documentation
- [x] Update README and GSD evidence, honestly identifying the ship as 2.5D SVG/CSS, not true 3D.
- [x] Run final full `npm test` (77 game-rule checks plus all suites, including landing test), configured Netlify build, `node --check` for 37 JavaScript files and `git diff --check` after all Phase 11 edits.

No deploy, commit, push or production-data change.

## Phase 12 — Final completion evidence and remaining browser work (2026-10-29)

### Milestone 1 — Correctness and live API verification
- [x] Re-inspect current worktree state, staged/unstaged diffs, GSD records, README, source and package scripts without changing the index or removing existing files.
- [x] Confirm Pilot renderer selection comes from `GunnerConsole` and preserve existing rendering/multiplayer architecture; regression remains in the configured suite.
- [x] Add endpoint readiness diagnostics, request timeouts, two-way chat/rate/isolation checks, and live Gunner cooldown/replay/full destruction/one-time score assertions to `test/api.room.integration.test.js`.
- [x] Run real local Netlify Dev HTTP integration: passed against `http://localhost:8888/.netlify/functions/game`. This resolved the earlier sandbox `fetch failed`: the same local route succeeds when the test is run with local socket access.
- [x] Run configured `npm test`: passed (77 game-rule checks plus every configured suite).
- [x] Run configured `node_modules/.bin/netlify.cmd build`: passed and packaged `game.js` and `cleanup-expired-rooms.js` (local build only).
- [ ] Fresh active two-client browser visual/input verification and requested responsive viewports.
- [ ] Hosted multi-instance Blobs consistency/rate-limit verification. Requires a deploy preview; deployment remains unauthorized.

### Milestone 2 — Final verification and evidence
- [ ] Re-run all-JavaScript syntax checks and `git diff --check` after this phase's final documentation edits.
- [x] Preserve all existing staged, unstaged and untracked work; no staging, commit, push, deploy or production-data change.
- [x] Fresh local Chrome smoke check: landing artwork rendered at the available ~1217×706 window; Create Room reached the one-member lobby and produced a six-letter code.

## Phase 13 — Compact gameplay HUD (2026-10-30; implementation unverified)

- [x] Move the cooperative radar/activity panel into the crew rail and give gameplay a dedicated central `game-stage` / `flight-scene` canvas.
- [x] Add compact status sizing, emergency-card strip constraints, scrollable active-alert list and stacked narrow-screen layout rules without changing game-state or network code.
- [x] Extend the existing structure test to protect the new canvas/crew/role arrangement.
- [ ] Visually inspect active gameplay and verify ship/asteroid pixels, actual role controls, live emergency responses and no clipping at five target viewports. The browser automation attempt was stopped by URL-policy confidence; no gameplay screenshot was captured after the change.
- [ ] Run final full suite/build/syntax/diff checks with the Phase 13/14 edits present.

## Phase 14 — Cinematic 2D warship landing redesign (2026-10-30)

- [x] Replace the flat inline-vector hero with an original generated 1536×1024 transparent Wayfarer carrier image stored locally at `assets/wayfarer-hero.png`.
- [x] Retain the existing splash/header/mission/skip/audio structure and actual Create Room / Join Room button IDs and application handlers.
- [x] Add a metallic-gradient, layered-shadow `SURVIVE TOGETHER` title and `SIGNAL SHIFT · SS-07` overline; deepen the existing CSS nebula/star atmosphere and add restrained engine lighting.
- [x] Keep the CSS image hover/float effects and mobile shallower title shadow under the existing reduced-motion rules; image includes alt text and intrinsic dimensions to limit layout shift.
- [x] Update landing structure regression coverage for the local artwork, title, handler wiring and responsive/reduced-motion rules.
- [ ] Visually inspect the new landing design at 1920×1080, 1440×900, 1280×720, 768×1024 and 390×844. Native browser inspection returned a gameplay screenshot while the bound accessibility state reported the landing URL, so this is not reliable evidence for the new landing.
- [ ] Verify Create Room and Join Room interactions in browser after the landing redesign.
- [x] Run final `npm test` (77 game-rule checks and all configured suites), configured local Netlify build, `node --check` across 37 JavaScript files and `git diff --check` after the implementation.

No deploy, commit, push, reset or production-data operation is authorized.

## Phase 15 — Landing frame cleanup and active ship visibility (2026-10-30)

- [x] Remove only the decorative rectangular border around `.splash-stage` and the card frame/background around `.splash-inner`; retain the separate briefing panel boundary, title extrusion shadows, secondary button boundary, separators and keyboard focus outlines.
- [x] Inspect the existing Canvas path: active frames call `SpaceRenderer.draw`; valid `round.flight.ship` coordinates are predicted by the shared physics model and passed to `drawShip`; impacts and Gunner shots render before the hull. No role-based visibility condition or landing-image dependency exists in the gameplay renderer.
- [x] Improve the existing procedural gameplay ship's scale and contrast; it remains an original Canvas illustration, follows shared predicted state, renders over world effects and requires no image/network load. The cinematic landing PNG remains confined to the landing stage because its full-frame composition is not a gameplay sprite.
- [x] Add focused landing and renderer assertions for frame removal, retained focus/boundaries, shared ship coordinates, size and render layering.
- [ ] Verify pixels, movement, resize and Gunner targeting in a fresh two-client active browser session and inspect landing at desktop/mobile sizes. Browser automation is not trustworthy in the current session; no visual acceptance is claimed.
- [x] Run final `npm test`, configured local Netlify build, `node --check` across 37 JavaScript files and staged/unstaged `git diff --check` after Phase 15 edits.

No deploy, commit, push, reset, or production-data operation is authorized.

## Phase 16 — Visual consistency and renderer recovery (2026-10-30)

- [x] Inspect staged/unstaged/untracked status, project docs and entry points; preserve all prior work.
- [x] Reproduce the renderer defect in a regression: a missing/invalid ship snapshot returned before drawing a valid shared asteroid list. Fix by rendering valid asteroids independently, with a three-second same-match last-authoritative-ship display grace and match-change cache reset.
- [x] Unify active gameplay rendering with the landing Wayfarer using the isolated Canvas ship silhouette, forest/cream hull materials, muted-gold engine glow and metallic asteroid rim. Keep the silver tunnel, restrained cyan shield/target treatment, shared physics prediction, state immutability, and existing loop.
- [x] Cover draw order, authoritative ship prediction, actual asteroid texture blit on invalid ship state, match-scoped fallback, no mutation, optional offscreen-texture failure and zero-size-to-laid-out resize recovery.
- [x] Verify real local HTTP host/guest shared ship + eight asteroid snapshots; verify guest sees Pilot movement and Pilot sees Gunner's server-applied asteroid health decrease. Full project integration passes with documented `ENABLE_TEST_MODE` and `TEST_ROUND_DURATION_MS=5000` local settings.
- [ ] Verify rendered pixels, both independent browsers, real keyboard input, Gunner targeting, resize, landing motion and console/network state. Browser accessibility showed the local game DOM, but returned screenshots displayed Codex instead of the selected browser; the configured browser provider is disabled. Do not claim visual acceptance.
- [x] Run final `npm test`, focused landing/renderer tests, configured local Netlify build, `node --check` across 37 JavaScript files and staged/unstaged diff checks after Phase 16 implementation.

The active-match screenshot's exact runtime state could not be captured. The confirmed blank-scene-capable source defect was the invalid-ship early return suppressing all asteroid drawing; the prior `_selectedAsteroidId` RAF exception remains separately fixed and regression protected. No production changes are authorized.

## Phase 17 — Responsive gameplay rendering diagnosis (2026-10-30)

- [x] Re-inspect staged, unstaged and untracked state plus the current Canvas, layout, Gunner, UI loop, tests and GSD history without changing the Git index.
- [x] Extend renderer regression coverage across 360×800, 390×844, 768×1024, 1366×768, 1920×1080 and 2560×1440 injected viewport measurements and DPR values; verify measured-container resizing, backing-buffer scale and shared normalized ship coordinates.
- [x] Expose unavailable Canvas context state and retry renderer initialization at a bounded interval while gameplay continues; regression verifies transient context recovery and no per-frame retry storm.
- [ ] Reproduce and identify the reported live wide-screen black scene in a real active match, with measured DOM/Canvas dimensions and console evidence. Current browser tool targeting is unreliable; no root cause for this specific report is confirmed.
- [ ] Verify real browser ship/asteroid visibility, resize recovery, Gunner aim/fire and two-client parity at available viewports.

## Phase 18 — Unified cinematic landing scene (2026-10-30)

- [x] Remove the mission briefing card border, background and inset shadow while retaining spacing, readable text, focus states and button surfaces.
- [x] Give the existing Wayfarer restrained horizontal/vertical drift and slight banking; preserve reduced-motion and Skip Intro behavior.
- [x] Add regression assertions for the borderless briefing, ship drift, reduced motion, working Create/Join handlers and responsive layout.
- [ ] Visually inspect ship/title/mission/actions at the six requested viewport sizes and verify room creation/join, audio and Skip Intro in a real browser. Source tests do not establish these visual or interactive outcomes.
- [x] Focused `node test/landing.test.js` and `node test/spaceRenderer.test.js` pass after these changes; final suite/build/syntax/diff checks are recorded in State/JOURNAL.

## Phase 17B + 18 verification update (2026-10-30)

- [x] Reproduce and repair the desktop zero-height flight scene using a dependency-free isolated Chrome/CDP harness against the existing local Netlify Dev server. Before the fix, active-match measurements at 768×1024, 1366×768, 1920×1080 and 2560×1440 showed `.flight-scene` heights of 0 CSS px and Canvas backing heights of 1 px, while room snapshots held a valid ship and eight asteroids. `.game-stage` now uses a flex column with the emergency panel and flight scene assigned bounded flex sizing.
- [x] Re-run the real two-client match and resize both clients through 360×800, 390×844, 768×1024, 1366×768, 1920×1080 and 2560×1440, then back through the same sizes without reload. All 12 steps had nonzero matching Canvas dimensions, a visible ship, and at least six renderer-reported asteroids per client. Match IDs and roles remained shared/valid; no browser console or page errors were captured.
- [x] Verify Pilot W thrust is observed by the other client and Gunner UI target selection reduces authoritative asteroid hull from 3 to 2 on the host. The six-target Gunner destruction/score path has earlier local browser evidence in `test-artifacts/phase17b-2026-10-29T20-25-18-177Z`; it was not repeated in the final viewport run.
- [x] Exercise landing Create Room/Join Room to enter the match, plus the landing audio toggle and Skip Intro. At 360×800, 1366×768, 1920×1080 and 2560×1440, artwork and copy fit without overlap or horizontal overflow. The original Wayfarer drift was observed and animation was disabled under reduced-motion emulation. Mobile image width was reduced to 96% of its stage to account for drift and avoid clipping.
- [x] Preserve repeatable, dependency-free browser evidence in `test/browser.rendering.cjs` and screenshots/JSON in `test-artifacts/phase17b-2026-10-29T20-34-50-823Z/` (24 active-game screenshots and four landing screenshots).
- [ ] Verify six simultaneous real players, every crew ability and complete mission progression in browser; verify deployed multi-instance behavior. Local browser proof is two clients only, and deployment remains unauthorized.

The blank wide-screen canvas was reproduced and traced to a zero-height `.flight-scene` grid child: the Canvas resize code consequently created a one-pixel backing buffer and the draw routine returned on zero CSS height. The final isolated Chrome run confirms the fix for two real clients across all six sizes and reverse resizing. Native Codex browser integration remains unavailable/unreliable; verification used isolated headless Chrome over CDP against the already-running local server. The server was not restarted or stopped. No deploy, commit, push, reset, or production-data operation occurred.

## Phase 21 — Gameplay Wayfarer and looping space video (2026-10-30)

- [x] Inspect the uploaded video and existing Wayfarer. The bundled video is H.264/AVC (`avc1`), 1280×720, 10.005 s, approximately 7.46 fps and 5,720,148 bytes. It is copied to `assets/wayfarer-space-background.mp4`. The landing PNG is RGBA but depicts the carrier from a fixed oblique camera angle; rotating it as a sprite would distort perspective, so gameplay retains a dedicated heading-aligned Canvas Wayfarer model with a longer carrier hull, layered plating, command canopy and twin engine pods.
- [x] Add a single muted, looping, inline video under the gameplay Canvas. The gameplay screen alone starts playback; hidden tabs and reduced-motion preference pause it. A rejected/unsupported video play leaves the existing procedural background fallback active.
- [x] Make the gameplay Canvas alpha-capable and change only the rendered world tint to translucent while video plays. Keep its opaque procedural backdrop when video is unavailable. Video does not cover the HUD or intercept input.
- [x] Remove the default asteroid circle stroke/halo (Phase 20 renderer change retained); preserve texture silhouettes, damage marks, the Gunner reticle, and four short directional warning ticks for marked threats.
- [x] Add renderer/lifecycle regressions and a dependency-free browser probe for video playback/looping, layer order, resize coverage, Pilot inputs, Gunner damage and console errors.
- [x] Real Chrome/CDP report `test-artifacts/phase17b-2026-10-29T21-21-44-747Z/report.json`: actual match video decoded at 1280×720, duration 10.005 s, muted, inline, active and looping; it wrapped three times. Canvas alpha/layer order and video cover passed. Both clients resized forward/back through six viewport sizes; at least seven renderer-counted asteroids and the ship appeared at every measured step. Pilot W thrust and A steering replicated to the peer; a Gunner-selected shot changed authoritative asteroid hull 3→2 on the other client. Zero browser/page errors.
- [ ] Repeat Gunner damage until destruction and verify score synchronization in a completed Phase 21 browser run. The existing gameplay logic is untouched; the final attempt ended from the random match before the firing-range retry could run. Earlier browser evidence for destruction/scoring predates Phase 21.
- [ ] Verify production/static-host delivery and performance on ordinary devices; deployment remains unauthorized.

A later repeated browser run ended the local match during viewport capture, so its resulting assertions failed; it does not supersede the complete successful report above. A prior failed repeat also hit a one-off temporary DevTools port-file lock. No production deploy, commit, push, reset, or production-data operation occurred.

## Phase 22 — Separate playable Wayfarer from gameplay background (2026-10-30)

- [x] Inspect four sampled frames of the supplied video. The ship changes viewpoint and fills most frames; temporal masking cannot produce a clean background without significant ship ghosts or reconstructed regions.
- [x] Preserve the source MP4 and landing artwork. Generate two separate original local assets matching the video palette/design: clean space plate `assets/wayfarer-gameplay-space.png` and transparent ship sprite `assets/wayfarer-gameplay-ship.png`.
- [x] Replace the ship-containing gameplay video layer with the clean image. Render the transparent sprite at the existing predicted authoritative ship position and heading, with thrust, shield and hull-hit visual cues. Keep the existing Canvas ship as a load-failure fallback; physics, collision, targeting and server state are unchanged.
- [x] Keep asteroid texture silhouettes, selected-target reticle, UI layering, and responsive world coordinates. Add regressions for clean asset wiring, fallback state, sprite drawing and entity layer order.
- [x] Real two-client Chrome/CDP run `test-artifacts/phase17b-2026-10-29T21-35-49-688Z/report.json`: both assets loaded; the transparent ship alpha and transparent corners were measured; both backgrounds covered six viewport sizes in forward and reverse passes; both sprite renderers loaded; ships/asteroids remained visible; Pilot W/A movement replicated; Gunner shot changed host-observed health 3→2; landing interactions passed; zero browser errors.
- [x] `npm test`, `netlify build`, `node --check` for 41 project JavaScript files, and staged/unstaged `git diff --check` passed.
- [ ] Repeat Gunner destruction and synchronized scoring in a complete browser run; the Phase 22 harness observed damage but no firing-based destruction/score result.
- [ ] Verify six concurrent players, deployment/static-host delivery, multi-instance behavior, and ordinary-device performance. No deployment is authorized.

Phase 22 supersedes the Phase 21 gameplay-video background choice. The original MP4 remains bundled but is not used behind the match; the gameplay background is a generated still image, not a segmented or looped video.

## Phase 23 — Coherent gameplay visual integration (2026-10-30)

- [x] Confirm the foreground ship is no longer present in the active gameplay background; retain the clean generated image and transparent playable Wayfarer from Phase 22.
- [x] Reduce the overlaid tunnel effect from 112 rays/680 trails to 12 subdued rays/96 short trails; soften the scene vignette and ship shadow. Keep the star field, existing asset palette, asteroids, selected-target reticle and gameplay feedback.
- [x] Add renderer regression checks that bound the ambient streak counts while preserving visible but curved trails.
- [x] Inspect actual active-match screenshots at 1920×1080 and 360×800 from `test-artifacts/phase17b-2026-10-29T21-51-33-761Z/`. Both show the clean image without a background ship, a single visible playable ship and visible asteroids; viewport matrix flags for scene sizing, sprite load, ship pixels and multiple asteroids passed.
- [ ] The same browser run observed host-replicated thrust and Gunner damage but did not observe heading change in the late Pilot key probe, then exited with an assertion. An earlier Phase 22 two-client run observed W/A movement and rotation. Recheck Pilot rotation in a fresh match independently of the long viewport matrix.
- [ ] Gunner destruction/score, six-player simultaneous play, full ability/mission progression, production delivery and ordinary-device performance remain open.
- [x] Focused renderer/background tests and final `npm test` pass; configured `netlify build` completed and bundled both functions; `node --check` passed for 41 project JavaScript files; staged and unstaged `git diff --check` passed after documentation edits.

The final Chrome run captured zero browser errors. It did not prove that every gameplay feature works; the keyboard-probe limitation is kept explicit.

## Phase 24 — Restore the original gameplay ship and space (2026-10-30)

- [x] Inspect the latest Phase 23 desktop/mobile screenshots, staged and unstaged renderer versions, source history, and prior GSD evidence. The Git index held the last known-good Canvas renderer and original ship/background implementation.
- [x] Restore the original heading-aligned Canvas ship silhouette, scale (`unit * .105`), orientation, blue-gray proportions and attached thrust/shield/hull-hit effects. Preserve predicted shared position and authoritative physics/input.
- [x] Restore the original procedural charcoal-space backdrop in the gameplay Canvas. Remove the gameplay image/video elements and controller references. Preserve the unused generated images and source video on disk.
- [x] Preserve asteroids, their textured silhouettes and damage marks, Gunner target reticle, effects, and gameplay/network/UI code.
- [x] Add regressions for the original hull palette/scale, backdrop particle/ray counts, opaque single-Canvas background, and absent media/sprite overlays.
- [x] Run `npm test`, configured Netlify build, JavaScript syntax checks, and staged/unstaged diff checks.
- [x] Verify a real local two-client match with isolated Chrome/CDP at 360×800, 390×844, 768×1024, 1366×768, 1920×1080 and 2560×1440; inspect desktop and mobile screenshots. Ship and multiple asteroids remained visible; Pilot thrust and rotation replicated; Gunner damage was observed on the peer (3→2); no browser errors.
- [ ] Repeat Gunner destruction and score synchronization in this run. This is outside the renderer restoration proof; the browser harness completed its initial shot, but the match ended before the optional kill retry.
- [ ] Six-player simultaneous browser behavior and deployed/multi-instance behavior remain unverified.

Evidence: `test-artifacts/phase17b-2026-10-30T03-27-10-952Z/report.json` and its viewport screenshots. The generated Phase 22 gameplay assets and original video are retained as unused files. No deploy, commit, push, reset, cleanup, or production data operation occurred.

## Phase 25 — Cinematic landing video and one-shot Pulse Cannon (2026-10-30)

- [x] Inspect the supplied MP4 and compare it with the existing landing composition. It is the existing 1280×720, 10.005-second, 5,720,148-byte asset (same SHA-256 as the repo copy). Browser decoding confirmed the dimensions/duration; screenshots at changing playback times show the ship at changing camera framings.
- [x] Replace the one landing-stage poster rendering with a muted, autoplaying, looping, inline Wayfarer video. Retain the original hero PNG as the poster/fallback; do not show duplicate large ships. Keep mission text, buttons, identity and controls intact. Use `object-fit: contain`, smaller responsive framing, screen blending, and nested horizontal/vertical feather masks to blend away frame edges.
- [x] Pause the video when the splash is inactive, the document is hidden, Skip Intro is selected, or reduced motion is preferred. Handle rejected playback and media errors while retaining the poster fallback. Keep preload at metadata and dimensions reserved to avoid blocking/layout shift.
- [x] Make one valid authoritative Pulse Cannon shot destroy the selected asteroid regardless of previous health. The stable server event reports its actual impact point and destruction; the existing room snapshot synchronizes removal and +50 score. Other asteroid IDs remain unaffected; replacement spawning uses a new ID to preserve the bounded moving field.
- [x] Preserve role/match/membership/range/cooldown/replay/rate-limit validation. UI shows target range rather than outdated multi-hit health, displays one-shot targeting and server destruction feedback, and clears a target when absent from the snapshot.
- [x] Add API-handler regressions for a 7-health target destroyed in one shot, exact +50 once, duplicate/replay safety, missing/destroyed/out-of-range targets, role authorization, cooldown, untouched other asteroids, synchronized snapshot/event/score and one-shot result contribution. Add Gunner UI regressions for single-shot copy, removal, cleared selection and destruction feedback.
- [x] Run real isolated Chrome/CDP against local Netlify Dev. Host and guest selected/fired through the UI; one shot removed the target on both clients, score moved 0→50 on both, original other asteroid IDs remained, and both clients shared the destroyed event/impact point. Pilot thrust/rotation also replicated; browser errors were zero.
- [x] Verify and inspect landing captures at 375×812, 768×1024, 1024×768, 1440×900 and 1920×1080. Video decoded and played muted/inline/looped at 1280×720, duration 10.005s; frame samples were nonempty at all sizes, video fit its stage, the original hero image remained only as the poster, and no horizontal overflow occurred. Playback advanced, reduced motion paused it, and mute/Skip/Create/Join controls remained active.
- [ ] Verify the full ten-second video loop wrap on a long-running production browser, mobile-device hardware decoding/performance, six-player/deployed behavior, and hosting delivery. Local browser verification completed only against the existing local Netlify Dev server.

Evidence/screenshots/report: `test-artifacts/phase17b-2026-10-30T05-08-16-682Z/` (final successful browser run). Earlier capture revealed visible rectangular edges; the nested two-axis feather mask and reduced frame size were applied and the final screenshots visually inspected. No deployment, commit, push, reset, cleanup, or production-data operation occurred.

## Phase 26 — Full-screen cinematic landing video (2026-10-30)

- [x] Move the existing single muted Wayfarer MP4 to the splash root as a full-bleed video layer. Cover the viewport with `object-fit: cover`, retain the supplied hero poster and CSS fallback, and remove the old framed/feathered stage.
- [x] Keep the forest-dark overlay, space atmosphere, fleet/distress identity, title, mission briefing, Create/Join actions, audio toggle, Skip Intro and keyboard focus above the non-interactive video layer.
- [x] Keep playback splash-scoped, muted, inline and looping; retain reduced-motion, hidden-tab and autoplay-failure handling. Existing landing audio-toggle behavior remains unchanged.
- [x] Update landing regression checks and Chrome/CDP viewport measurements for the full-bleed implementation.
- [x] Local Chrome rendered the actual landing screen at 375×812, 768×1024, 1024×768, 1440×900 and 1920×1080. All five measurements passed viewport coverage, video decode/play/mute/loop/inline, readable content and controls in bounds, no overlap and no horizontal overflow. The final capture has zero browser errors. Screenshots/report: `test-artifacts/phase17b-2026-10-30T05-17-38-657Z/`.
- [ ] The all-in-one browser harness exits afterward on its separate gameplay Pilot input probe: the host remained focused and Pilot, but the guest did not observe thrust/rotation. Landing measurements had already passed. This phase does not change gameplay inputs; that gameplay check remains unverified in this browser run.
- [x] Run final checks after documentation: `npm test` passed (77 game-rule assertions and every configured suite); project-local Netlify build passed and bundled both existing functions; `node --check` passed for 42 project JavaScript files; staged and unstaged `git diff --check` passed.

No deploy, commit, push, reset, cleanup, or production-data operation occurred.

## Phase 27 — Remove landing planet circle (2026-10-30)

- [x] Identify `.splash-planet` inside `.splash-cosmos` as the large bottom-left green circle. Remove only that element and its two circle-specific CSS rules; keep all other atmospheric layers, video and landing layout intact.
- [x] Add a landing regression assertion that the planet markup/style do not return.
- [x] Verify local Chrome captures at mobile 375×812, laptop 1024×768, and desktop 1440×900. The video is visible in the former circle area; viewport/layout checks pass across the full five-size matrix and browser errors are zero. Report and captures: `test-artifacts/phase17b-2026-10-30T05-21-40-528Z/`.
- [x] `npm test` passed; configured project-local Netlify build passed; `git diff --check` and `git diff --cached --check` passed.

No deploy, commit, push, reset, or production-data operation occurred.

## Phase 28 — Remove floating landing spheres (2026-10-30)

- [x] Identify the three glossy sphere overlays as `.splash-asteroid` elements in the landing `.splash-cosmos` layer. Remove those three nodes and their four dedicated CSS rules only; retain other atmospheric layers and gameplay asteroid rendering.
- [x] Add regression assertions preventing the landing sphere markup and rules from returning.
- [x] Verify a real local Chrome run at mobile, laptop, desktop and ultrawide sizes. All five landing viewport checks passed, video and remaining design stayed in place, and browser errors were zero. Screenshots/report: `test-artifacts/phase17b-2026-10-30T05-23-36-678Z/`.
- [x] `npm test`, configured local Netlify build, `git diff --check`, and `git diff --cached --check` passed.

No deploy, commit, push, or reset occurred.

## Phase 29 — complete application audit and Gunner one-shot (2026-10-30)

### Completed with local evidence
- [x] Audit the current source, tests, assets, Netlify configuration, README and GSD records; preserve existing work.
- [x] Verify/update the Gunner regression expectation: one valid shot removes only its selected asteroid, awards +50 once, synchronizes removal/score, and retains authorization, cooldown and replay protections.
- [x] Extend local API integration assertions for duplicate join rejection, Navigator mark authorization/shared state, and one-shot Gunner removal/score/untouched asteroids/replay/cooldown.
- [x] Validate local landing and gameplay rendering in isolated Chrome/CDP at mobile, tablet, laptop, desktop and ultrawide widths; verify two-client Pilot movement and Gunner destruction/score. Evidence/report: `test-artifacts/phase17b-2026-10-30T05-59-24-594Z/`.
- [x] `npm test`, `netlify build`, and local Netlify Dev API integration passed.
- [ ] Complete full mission/victory or defeat/results/rematch in an interactive two-client browser run; test every role ability, every Pilot key, and Enter-to-send chat in-browser.
- [ ] Verify with six simultaneous browser clients (local API capacity tests cover six seats, not six rendered clients).
- [ ] Run physical-device/mobile performance and assistive-technology/keyboard-only audits.
- [ ] Verify deployed Netlify Blobs conditional writes across instances, hosted rate limiting, scheduled cleanup and static delivery in an authorized deploy preview.

### Release gate

Local code/build checks pass and the one-shot Gunner path is verified through browser and live local API evidence. Overall status: **not fully locally release-ready** because the complete browser mission/lifecycle and all requested manual interactions remain unverified. Production readiness is **BLOCKED** on hosted infrastructure access/authorization; no deployment or production operation was performed. The exact feature evidence ledger is in the Phase 29 section of `README.md`.

## Phase 30 — authoritative Pulse Cannon projectile timing (2026-10-30)

- [x] Fix the concrete premature-destruction defect: the former FIRE handler removed its target immediately and the visual bolt only animated afterward. FIRE now creates a server-owned projectile; asteroid and score remain unchanged until server-confirmed collision.
- [x] Simulate projectile position from the source and velocity within the existing authoritative flight ticks, alongside the moving asteroid field. Sweep the projectile's segment relative to the target's segment so fast projectiles cannot skip a collision. Only the selected target is eligible; a missing target or expired/out-of-range projectile becomes a miss.
- [x] Record stable launch/impact event data. Render the active authoritative projectile as a cyan pulse with a bright head and trail; render the muzzle at launch and debris/impact only at a confirmed impact timestamp. Both clients extrapolate the same timestamped state for display. Public snapshots redact the private shooter session ID.
- [x] Award +50 and the Gunner destruction contribution only from the tick that confirms collision. Action receipt, role/range/cooldown/rate/replay/room authorization remain on the existing API path.
- [x] Add physics regressions for alive-at-launch and mid-flight, confirmed impact, miss, selected-target-only destruction, and high-speed swept collision. Add handler assertions for duplicate-launch protection, peer-visible in-flight state, no pre-impact score, impact-only score, and session-ID redaction.
- [x] Live local HTTP integration passed: another room session observed the moving projectile and living target with score 0 before impact, then target removal and score 50.
- [x] Focused isolated Chrome/CDP two-client run passed with zero browser errors. Both clients had an active projectile and living target at score 0; timestamp-extrapolated positions were within 0.06 world units. Both later observed impact/removal/+50 and the selected target alone was consumed. Capture/report: `test-artifacts/phase17b-2026-10-30T06-28-27-443Z/`.
- [x] `npm test`: passed (77 game-rule assertions and all configured suites). `.\node_modules\.bin\netlify.cmd build`: passed and bundled both functions. Syntax checks passed for project JavaScript files. Staged and unstaged diff checks passed.
- [ ] Full responsive browser matrix in a single active match remains unverified for this run: the existing short local test round ended during the later reverse viewport sweep. A previous broad run also captured projectile travel and impact but failed its later viewport aggregate for the same lifecycle reason; do not treat those aggregate viewport flags as PASS.
- [ ] Hosted multi-instance storage and production delivery remain outside local verification and were not deployed.

Phase 30 supersedes the Phase 25 immediate-destruction implementation note. The Gunner requirement is now collision-delayed in the authoritative simulation, not just in its rendering.

## Phase 31 — Gunner first-contact timing and faster Pulse Cannon (2026-10-30)

- [x] Increase the configurable projectile speed from 0.24 to 0.6 world units/second (2.5×).
- [x] Use earliest swept-circle contact against the selected asteroid's same-substep movement and combined projectile/asteroid radii. Stop authoritative projectile position at contact; score/destroy only on confirmed impact.
- [x] Clamp rendered prediction with the shared collision helper, including a moving-target display regression so delayed snapshots cannot show a bolt beyond contact.
- [x] Keep launch muzzle/cyan projectile and impact/debris rendering tied to launch/projectile/authoritative collision state.
- [x] Extend tests for first contact, miss, high-speed tunneling, speed, moving-target render clamp, duplicate/replay score protections and synchronized impact.
- [x] `npm test`, local Netlify build and live API integration passed.
- [x] Isolated two-client Chrome verification passed distant (56% range) and near (13% range) UI-selected targets. Shooter received a live projectile before impact; both clients received the same confirmed impact and +50 score. Report: `test-artifacts/phase17b-2026-10-30T16-12-11-109Z/`.
- [x] Project JavaScript syntax and `git diff --check` passed.

Hosted multi-instance/production behavior remains unverified and no deployment was performed.

## Phase 32 — Instant authoritative impact presentation (2026-10-30)

- [x] Prevent a newly fired projectile from traversing elapsed simulation time before its launch timestamp when the FIRE request also ticks the room.
- [x] Align the asteroid start coordinate with the projectile's actual simulated start for swept collision; preserve first-contact position and same-update removal/score.
- [x] Start the impact effect as soon as the authoritative destruction event is applied; don't gate it on client/server wall-clock comparison.
- [x] Preserve monotonic stale-snapshot rejection; add an asteroid restoration regression.
- [x] Poll active gameplay at 250 ms and active projectile state at 80 ms, with existing lobby cadence unchanged.
- [x] Add tests for pre-launch catch-up, single-update collision, immediate render with skewed timestamps, impact coordinate and stale snapshot rejection.
- [x] Two-client Chrome verified distant/near shots and event synchronization. Distant shot: host rendered 13 ms after event receipt/91 ms after collision; guest rendered 10 ms after receipt/109 ms after collision. Report: `test-artifacts/phase17b-2026-10-30T16-21-21-332Z/`.
- [x] `npm test`, configured Netlify build, live API integration, syntax checks for 43 JS files and staged/unstaged `git diff --check` all passed after current edits.

No deployment, commit, push, reset or production data operation occurred. Hosted multi-instance behavior remains unverified.

## Phase 33 — Production polling load guard (2026-10-31)

- [x] Before the local fix, compare the deployed static client assets with the checkout: all 17 script assets in the live HTML matched byte-for-byte.
- [x] Trace active polling through `get_state`: every poll ticks the room and performs an ETag-protected Blob write; production bypasses the local per-process mutation queue.
- [x] Reduce active poll spacing from 250/80 ms to 750/650 ms after each response, retaining 1500 ms lobby polling and the existing no-overlap guard.
- [x] Add bounded exponential retry backoff for repeated poll errors (1500 ms up to 8000 ms) and regression coverage for cadence/backoff.
- [ ] Verify valid-room Blob latency, multi-client contention and gameplay in production. The measured 725–1273 ms API requests had no room code and were rejected before Blob reads/writes, so they are only endpoint/runtime baseline timings.
- [ ] Browser-based local/production movement and synchronization comparison remains outstanding; the browser tool reports local browser use disabled.
- [ ] Local API integration could not run because Netlify Dev could not retrieve the linked site (Not Found) and the configured port 8888 was already occupied.

This local adjustment reduces write pressure but is not evidence that deployed gameplay performance is fixed; production still serves the pre-change polling cadence until an approved deployment. No production room was created or changed; no deployment, commit, push, reset or cleanup occurred.
