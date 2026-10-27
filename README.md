# Signal Shift: Survive Together

> Real-time multiplayer browser game — Handshake AI Skills Studio × OpenAI "Create a Multiplayer Game" mission.

**2–6 players · No account required · Share a 6-letter room code**

Players are a spaceship crew facing 90 seconds of escalating emergencies. Coordinate roles, respond to threats, and keep the hull above zero to win.

---

## Quick Start (Local Development)

### Prerequisites
- Node.js 18+
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
│   ├── poller.js              ← 1500ms polling engine
│   ├── ui.js                  ← DOM renderer
│   └── app.js                 ← Application state machine
├── shared/
│   └── gameRules.js           ← CommonJS game logic (server-only import)
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
| Real-time | Client polling every 1500ms | WebSockets not supported in Netlify Functions; polling is sufficient for 90s coordination game |

### Server authority
All timers, hull integrity, scores, and emergency state live exclusively in Netlify Blobs. Clients are **thin renderers only** — they never own game state.

### Concurrency protection
Every write uses ETag optimistic locking (`onlyIf: { etag }`). On a 412 conflict the function retries up to 4 times with small backoff. This prevents two simultaneous actions from corrupting the blob.

### Multiplayer is real
This is **not** two independent local-state browser tabs. Every poll reads from the same Netlify Blob, and every action writes to it. Players on separate phones see the same hull value, same emergencies, same timer.

---

## Gameplay Overview

| | |
|---|---|
| **Duration** | 90 seconds per round |
| **Starting hull** | 100% |
| **Win** | Timer reaches 0 with hull > 0 |
| **Lose** | Hull reaches 0 |

### Roles (assigned by join order)

| Players | Roles |
|---|---|
| 2 | Engineer, Navigator |
| 3 | + Systems Officer |
| 4 | + Medic |
| 5 | + Gunner |
| 6 | + Commander |

**Engineer is the universal fallback** — they can respond to any emergency with a 2× cooldown cost, ensuring 2-player games are always winnable.

### Emergencies

Emergencies spawn on a pre-generated Poisson schedule (seeded by `startedAt`). The first emergency always appears at 15 seconds (tutorial window). After that, mean inter-arrival time decreases from 15s to 8s as the round progresses.

| Type | Damage | Resolved by |
|---|---|---|
| Engine Fire | 3 HP/s | Engineer |
| Hull Breach | 5 HP/s | Engineer |
| Oxygen Leak | 2 HP/s | Medic / Engineer fallback |
| Nav Failure | 1 HP/s + 5 on expiry | Navigator / Engineer fallback |
| Rogue Asteroid | 12 HP on expiry | Navigator or Gunner |
| Power Surge | 2 HP/s + 8 on expiry | Systems Officer / Engineer fallback |
| Radiation Burst | 4 HP/s | **Any crew member** |

### Scoring

```
Win:  1000 + (remaining_seconds × 10) + (hull% × 5) + (resolved × 75) + (speed_bonuses × 25)
Lose: (hull% × 5) + (resolved × 75) + (speed_bonuses × 25)
```

Speed bonus: +25 for each emergency resolved within 5s of spawning.

---

## Testing

### Unit test (game rules logic)
```bash
node test/gameRules.test.js
```

### Manual two-player test
1. `npm run dev`
2. Open `http://localhost:8888` in Tab A → Create Room
3. Open `http://localhost:8888` in Tab B → Join Room (use the code from Tab A)
4. Host clicks Launch Mission
5. Verify both tabs see the same timer, hull, and emergencies
6. Resolve emergencies and verify score updates on both tabs

### Disconnect test
1. Start a 2-player game
2. Close Tab B (disconnect the second player)
3. Wait 10s — Tab A should show the second player as disconnected (grey dot)
4. Re-open Tab B with the same URL, re-join — player reconnects

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
- **Node.js version**: 18+ (set in Environment Variables: `NODE_VERSION=18`)
- **Blobs**: automatically provisioned when you deploy a function that uses `@netlify/blobs`

### Verify deployment
After deploy, open `<your-netlify-url>` on two separate phones and play a full round.

---

## Environment Variables

No secrets are required. `@netlify/blobs` automatically uses Netlify-injected credentials in the function runtime. For local development, `netlify dev` injects them automatically via the CLI.

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
