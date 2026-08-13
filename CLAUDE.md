# Quizzinator

A live, in-person party quiz. One person hosts from a laptop plugged into a
TV that everyone in the room can see; everyone else joins from their own
phone browser and answers there. No accounts, no database — a quiz is a
single ephemeral event.

## Roles / screens

- **Host / TV screen** (`/host/:sessionId`) — big-screen view: lobby with a
  join link + short code and a QR code, the current question,
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
| `number` | slider (MUI `Slider`, a native `<input type="range">` under the hood), bounds/step from the question | distance from `correctValue`, closer = more points, linear falloff to 0 at `scoreToleranceValue` |
| `geo` | tap-to-place a pin on a [Leaflet](https://leafletjs.com/) map (OpenStreetMap tiles — free, no API key, matters for free-tier hosting) | Haversine distance to `correctLat/correctLng`; points fall off to 0 at `maxDistanceKm` |
| `fuzzy-text` | free-text input | normalized similarity via [`fastest-levenshtein`](https://github.com/ott-jarv/fastest-levenshtein) against `acceptedAnswers`, correct if similarity ≥ per-question `threshold` |

**Score falloff is per-question and independent of the input widget.** Both
partial-credit types take a tolerance field — `maxDistanceKm` for `geo`,
`scoreToleranceValue` for `number` — naming the error at which the score
reaches 0, with a linear falloff from full `points` at an exact hit. For
`number` this is deliberately *not* the slider's own `min`/`max`: a slider
can span 0-2026 so the answer isn't obvious from where the handle starts,
while only guesses within ±20 score anything. It defaults to `max - min`
(the behaviour from before the field existed) and a tolerance of 0 means
only an exact hit scores. Both are **JSON-only, not editable from the admin
screen** — the admin flow is deliberately one click from "pick a set" to a
shareable join code, and a per-question editor would turn that into a
form-filling step for something a question author already had to decide
when writing the set.

Shared fields: every question has `points`, an optional `media.imageUrl`
(remote URL or a path resolved from an extracted question-set ZIP), and an
optional `timeLimitSec` — **defaults to 30s** when omitted. The server owns
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
- Why this matters for hosting: the app ships as a **Docker container with
  no volumes mounted by default** — anything written to `server/data/` or
  held in the in-memory session `Map` is wiped whenever the container is
  recreated (redeploy, restart, host reboot). That's fine here, because a
  quiz is a single live event: if the container restarts mid-quiz the host
  just re-uploads the question set and starts again. On the home-server
  deployment the container can optionally be given a persistent volume for
  `server/data/` (nice-to-have, not required), but the code makes no
  assumption that disk or memory survives a restart, so it behaves
  correctly either way.

## Realtime transport (decided)

[Socket.IO](https://socket.io/) (not raw `ws`) specifically for its built-in
reconnection with back-off and automatic fallback from WebSocket to HTTP
long-polling — needed for the "fault tolerant" requirement on flaky venue
wifi, and for consistent behavior across Safari and Chrome (Safari's
WebSocket behavior over some proxies/networks is a common source of pain,
long-polling fallback sidesteps that). The full join/start/answer/reveal
event protocol is defined by the realtime-engine issue, not this scaffold.

**Reconnecting is a handshake, not just a transport concern.** Socket.IO
restores the *connection* on its own, but the reconnected socket has a new
socket id that the server does not associate with any session — it is not
in the session's room and receives nothing further. So both clients re-emit
their join (`host:join` / `player:join`) on every `connect`, not only on
mount, and the player's display name is persisted next to their id so the
phone can do this unattended. `player:join`'s ack carries the in-flight
question and whether that player already answered it, because the ack is
the only per-socket message a rejoining phone gets. This is what makes an
iPhone screen-lock mid-question a non-event rather than a dead session.

## Access control (decided)

There are no accounts, so "who's allowed to do what" rests entirely on
secrets handed out by the server, with different guessability
requirements:
- The **join code** (5 unambiguous uppercase letters/digits, shown on the
  TV and typed by players) only lets you join a lobby as a player — low
  stakes, and it's short on purpose so people can read/type it off a
  screen.
- The **host token** (a long random secret, returned only in the
  `POST /api/sessions` response body to whoever created the session) is
  required by the `host:join` socket event. Without it, knowing/guessing a
  session's id or join code is *not* enough to take over hosting — you
  can't reveal answers, skip questions, or end someone else's quiz early.
  The client keeps it in `sessionStorage` (not the URL/query string), so
  it isn't shown on screen, isn't in browser history, and isn't logged by
  proxies the way a URL would be.
- The **player token** (a long random secret, returned only in that
  player's own `player:join` ack) is the same idea one level down. A
  `playerId` is *public* — it has to be, the leaderboard and every reveal
  payload carry it to the whole room — so it can't also be proof of who
  you are. Rejoining under an existing `playerId` requires its token, and
  `answer:submit` doesn't take a `playerId` at all: the server resolves the
  answering player from the socket that joined. Without both halves, anyone
  in the room could rejoin as a rival (taking their name and score) or
  submit garbage in their name before they answered, since the first
  submission for a player wins. Player ids are always server-generated; an
  unknown id in a join is treated as a phone carrying leftovers from a dead
  session and gets a fresh identity, not an error. The phone keeps the
  token in `localStorage` next to the id and name, because the unattended
  rejoin-on-reconnect needs all three.
- `GET /api/sessions/by-code/:code` (unauthenticated, so effectively
  guessable/brute-forceable given enough requests) deliberately returns
  only `{ code, state }` — never the internal `id` — so it can't be used
  to escalate a guessed join code into the sessionId `host:join` needs.

## Tech stack (decided)

- **Monorepo**, npm workspaces: `server/` (Express + TypeScript, ESM) and
  `client/` (React + TypeScript + Vite). React chosen over Vue — no strong
  driver either way, React has the better ecosystem fit for the map/slider
  libraries this needs.
- **One Node process in production**: Express serves the built client
  (`client/dist`) as static files *and* the API/websocket from the same
  origin/port. No separate static host, no CORS complexity, matches a single
  Render "Node" web service and a single process on the home server.
- **Design system**: **MUI** (`@mui/material` + Emotion) with a single dark
  theme in `client/src/theme.ts` — one palette, one type scale and one set
  of component defaults shared by the TV and the phones, with `clamp()`
  sizes so the same components read from a sofa and from a hand. This
  *reverses* the original "no component library, hand-rolled CSS" decision:
  the hand-rolled stylesheet was cheap but the app looked it, and matching
  Material's states/elevation/focus behaviour by hand was turning into a
  second-rate reimplementation of MUI. It costs ~80kB gzipped
  (132kB → 212kB of gzipped JS), paid once on join over venue wifi and
  cached after; the confetti library is lazily imported so it stays off
  that first load. Icons stay on the Material Symbols Rounded *font*
  (loaded from Google Fonts, wrapped by `components/AppIcon.tsx`) rather
  than `@mui/icons-material`, which would ship SVG components for a handful
  of glyphs. What is left in `client/src/styles.css` is only what a
  component library can't own: the icon font's variable-axis setup and
  Leaflet's imperatively-created DOM.
- **Testing**: Vitest in both workspaces (+ Supertest for the Express API,
  Testing Library for React components).
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci`, lint
  (`tsc --noEmit`), test, and build on every push/PR. A separate workflow
  (`.github/workflows/docker-publish.yml`) builds and pushes the Docker
  image, but only when a GitHub Release is published (see Deployment
  below) — not on every push to `main`.
- **Workflow**: Claude opens a PR for any change rather than pushing
  directly to `main`.

## Deployment (decided)

Docker, not a PaaS. A single minimal multi-stage `Dockerfile` at the repo
root builds the client (Vite) and server (`tsc`), then produces a small
runtime image (e.g. `node:20-alpine`) containing only `node_modules`
(production deps), the compiled server `dist/`, and the built
`client/dist`, running `node server/dist/index.js` as its entrypoint.
`PORT` is read from the environment; it defaults to `3001` if unset,
matching local dev.

CI/CD (GitHub Actions, `.github/workflows/docker-publish.yml`) builds this
image and pushes it to the **GitHub Container Registry**
(`ghcr.io/1-alex98/quizzinator`) only when a **GitHub Release is
published** — not on every push to `main` — tagged with the release's
semver tag (e.g. `v1.2.3`) and `latest`, authenticated with the workflow's
built-in `GITHUB_TOKEN` (`packages: write` permission) — no separate
registry account or secret to manage. Cutting a release means tagging a
commit on `main` as `vX.Y.Z` and publishing a GitHub Release from it.
Deploying anywhere (a home server, any other Docker host) is then just
`docker run -p 8080:8080 ghcr.io/1-alex98/quizzinator:latest` — the image
sets `PORT=8080` by default (override with `-e PORT=...` for a different
port) — no code changes needed, just more RAM/CPU and, optionally, a
mounted volume for `server/data/`.

The host's shareable link is `<deployed-origin>/play/<code>` — generated
from the short join code returned when a session is created
(`POST /api/sessions`), so the host can copy/share it however they like
(text, AirDrop, a displayed QR code) without a separate link
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
    theme.ts             # the one MUI dark theme (palette, type scale, defaults)
    views/               # one component per route
    components/           # Screen shell, answer inputs, leaderboard, icons
    lib/socket.ts         # shared Socket.IO client + rejoin-on-reconnect helper
    lib/celebrate.ts       # lazily-imported confetti, no-op if reduced motion
    styles.css            # only what MUI can't own: icon font axes + Leaflet
Dockerfile              # multi-stage build -> small node:20-alpine runtime image
.dockerignore
.github/workflows/ci.yml # lint/test/build, then build+push the Docker image to GHCR
```

## Local development

```
npm install
npm run dev     # runs the Express API (3001) and Vite dev server (5173) together,
                 # Vite proxies /api and /socket.io to the API so the browser
                 # only ever talks to one origin, same as production
npm test         # server + client test suites
npm run build     # production build (client bundle, then server tsc)
npm start          # runs the production build (what the Docker image runs)
```

## Current status

All gameplay, the question-set import pipeline, and CI/CD are implemented:

1. Realtime quiz engine — session state machine, Socket.IO event protocol,
   server-driven timer, reconnect/rejoin handling.
2. Number + geo-guessing question types — slider and Leaflet map UI,
   distance-based scoring.
3. Fuzzy-text question type + mobile/TV screen polish — Levenshtein
   matching, per-phase mobile screens, TV lobby/leaderboard.
4. Question set import pipeline — ZIP/JSON upload endpoint, schema
   validation, zip-slip-safe extraction, image serving, admin upload UI.
5. CI/CD + deployment — CI builds and pushes a Docker image to the GitHub
   Container Registry on every push to `main`; the host lobby screen shows
   the shareable join link plus a QR code.
6. UI on MUI + polish — one dark theme across host/play/admin, redesigned
   TV leaderboard, shared countdown ring, big host images with a
   collapsible image toggle on mobile, confetti on a correct answer,
   per-question `scoreToleranceValue`, and rejoin-on-reconnect so a locked
   phone rejoins its session by itself.
