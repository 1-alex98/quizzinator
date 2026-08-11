# Quizzinator

A live, in-person party quiz. One person hosts from a laptop plugged into a
TV that everyone in the room can see; everyone else joins from their own
phone browser and answers there. No accounts, no database — a quiz is a
single ephemeral event.

## Roles / screens

- **Host / TV screen** (`/host/:sessionId`) — big-screen view: lobby with a
  join link + short code (and a QR code, once added), the current question,
  a countdown timer, and the leaderboard between questions. This is the
  shared "public" view everyone in the room watches.
- **Mobile participant app** (`/play/:code`) — the phone UI each player uses
  to join and answer. One phase fills the screen at a time (waiting /
  answering / waiting-for-others / reveal); no scrolling, icon-forward,
  minimal text, dark Material-style theme.
- **Admin / upload** (`/admin`) — where the host picks a question set
  (JSON or ZIP) before starting the quiz.

Both the host and mobile views are the *same* React SPA rendering different
routes, not separate apps — they share the socket client, design tokens, and
build. This was chosen over 2-3 separate front-ends to avoid duplicating the
realtime/reconnect logic and keep the deploy to a single service.

## Question types (decided)

| Type | Player input | Scoring |
|---|---|---|
| `number` | native `<input type="range">` slider, bounds/step from the question | distance from `correctValue`, closer = more points |
| `geo` | tap-to-place a pin on a [Leaflet](https://leafletjs.com/) map (OpenStreetMap tiles — free, no API key, matters for free-tier hosting) | Haversine distance to `correctLat/correctLng`; points fall off to 0 at `maxDistanceKm` |
| `fuzzy-text` | free-text input | normalized similarity via [`fastest-levenshtein`](https://github.com/ott-jarv/fastest-levenshtein) against `acceptedAnswers`, correct if similarity ≥ per-question `threshold` |

Shared fields: every question has `points`, a required `prompt` (text), an
optional `media.imageUrl` (remote URL or a path resolved from an extracted
question-set ZIP), and an optional `timeLimitSec` — **defaults to 30s** when
omitted. This applies uniformly across all three types: a question is either
**text-only** (`prompt`, no `media`) or **image + text** (`prompt` plus
`media.imageUrl`) — never image-only. Both the mobile answer screen and the
host/TV screen render the prompt (and the image above/alongside it, when
present) the same way regardless of question type, before/around the
type-specific answer widget (slider / map / text input). The server owns
the countdown and is the single source of truth for time remaining (clients
just render what the server tells them), so the timer shown on the TV and on
phones can't drift apart even under bad wifi.

## Question set delivery (decided)

A question set is either:
- a single `.json` file (images referenced by URL only), or
- a `.zip` containing the JSON plus local image files, referenced from the
  JSON by relative path.

`adm-zip` is used to read the archive server-side. **Zip-slip protection is
mandatory**: every entry's resolved path must be verified to stay inside the
extraction directory before writing (reject `..` segments, absolute paths,
and symlink entries) — implemented as part of the import pipeline issue, not
yet in this scaffold.

## Storage: no SQL, mostly in-memory (decided)

- **Quiz/session state** (players, scores, current question, phase, timer)
  lives entirely in a server-side `Map` — see `server/src/sessionStore.ts`.
  It does not survive a process restart, which is fine: a quiz is a single
  live event, not data anyone needs to keep.
- **Uploaded question sets** are extracted to `server/data/<setId>/` on
  local disk, *not* held fully in memory — only the parsed question JSON
  (small) lives in memory; images are served from disk via a static route /
  streamed, so a set with many/large images doesn't blow up process RAM.
- Why this matters for hosting: **Render's free web service tier gives
  ~512MB RAM, a shared/fractional CPU, and an *ephemeral* disk** — local
  files (including anything under `server/data/`) are wiped on every
  redeploy or restart, and the service spins down after ~15 minutes idle
  (cold start on the next request). None of that is a problem here, because
  in-memory sessions are equally wiped on restart — the host just re-uploads
  the question set if that ever happens. A quiz in progress keeps the
  service busy/warm for its own duration. On the home-server deployment
  (plenty of RAM, persistent disk, always-on) none of these constraints
  apply, but the code is written to the tighter Render limits so it works in
  both places unchanged.

## Realtime transport (decided)

[Socket.IO](https://socket.io/) (not raw `ws`) specifically for its built-in
reconnection with back-off and automatic fallback from WebSocket to HTTP
long-polling — needed for the "fault tolerant" requirement on flaky venue
wifi, and for consistent behavior across Safari and Chrome (Safari's
WebSocket behavior over some proxies/networks is a common source of pain,
long-polling fallback sidesteps that). The full join/start/answer/reveal
event protocol is defined by the realtime-engine issue, not this scaffold.

## Tech stack (decided)

- **Monorepo**, npm workspaces: `server/` (Express + TypeScript, ESM) and
  `client/` (React + TypeScript + Vite). React chosen over Vue — no strong
  driver either way, React has the better ecosystem fit for the map/slider
  libraries this needs.
- **One Node process in production**: Express serves the built client
  (`client/dist`) as static files *and* the API/websocket from the same
  origin/port. No separate static host, no CORS complexity, matches a single
  Render "Node" web service and a single process on the home server.
- **Design system**: no component library (MUI, etc.) — a small hand-rolled
  CSS file (`client/src/styles.css`) using the Material Symbols Rounded
  icon font (loaded from Google Fonts) plus a couple of CSS custom
  properties. Keeps the bundle light for low-powered phones and avoids
  fighting a heavy library for a "mostly icons, little text, no scroll" UI.
- **Testing**: Vitest in both workspaces (+ Supertest for the Express API,
  Testing Library for React components).
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci`, lint
  (`tsc --noEmit`), test, and build on every push/PR.
- **Workflow**: Claude opens a PR for any change rather than pushing
  directly to `main`.

## Deployment (decided)

Render, "Node" native runtime (not a static site + separate API): build
command `npm run build`, start command `npm start`, single web service.
`PORT` is read from the environment (Render sets this); locally it defaults
to `3001`. Eventually redeployed to a home server with the same two
commands — no code changes needed, just more RAM/CPU and a persistent disk.

The host's shareable link is `<deployed-origin>/play/<code>` — generated
from the short join code returned when a session is created
(`POST /api/sessions`), so the host can copy/share it however they like
(text, AirDrop, a displayed QR code once added) without a separate link
shortener.

## Repo layout

```
server/
  src/
    index.ts          # process entry: http server + express app + socket.io
    app.ts             # express app factory (also serves client/dist)
    realtime.ts        # socket.io bootstrap (transport only, see below)
    sessionStore.ts     # in-memory Map<sessionId, QuizSession>
    types.ts            # shared domain types (Question, QuizSession, ...)
    routes/api.ts        # REST endpoints
  data/                 # extracted question-set uploads (gitignored)
client/
  src/
    main.tsx            # router: /, /host/:sessionId, /play/:code, /admin
    views/               # one component per route (placeholders for now)
    lib/socket.ts         # shared Socket.IO client
    styles.css            # design tokens + Material Symbols setup
.github/workflows/ci.yml
```

## Local development

```
npm install
npm run dev     # runs the Express API (3001) and Vite dev server (5173) together,
                 # Vite proxies /api and /socket.io to the API so the browser
                 # only ever talks to one origin, same as production
npm test         # server + client test suites
npm run build     # production build (client bundle, then server tsc)
npm start          # runs the production build (what Render/the host server run)
```

## Current status / what's left

This scaffold wires up the routing, transport, and a couple of REST
endpoints (`GET /api/health`, `POST /api/sessions`,
`GET /api/sessions/by-code/:code`) but **no gameplay yet**. The remaining
work is tracked as GitHub issues:

1. Realtime quiz engine — session state machine, Socket.IO event protocol,
   server-driven timer, reconnect/rejoin handling.
2. Number + geo-guessing question types — slider and Leaflet map UI,
   distance-based scoring.
3. Fuzzy-text question type + mobile/TV screen polish — Levenshtein
   matching, per-phase mobile screens, TV lobby/leaderboard.
4. Question set import pipeline — ZIP/JSON upload endpoint, schema
   validation, zip-slip-safe extraction, image serving, admin upload UI.
5. CI/CD + deployment — flesh out GitHub Actions as needed, Render service
   config, host share-link/QR flow.
