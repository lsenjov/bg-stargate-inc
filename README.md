# Stargate Inc. online

Server-authoritative multiplayer web app for the currently defined connection-selection round. The full board game is still in design; incomplete systems remain visible as unresolved in the in-app rulebook.

## Local development

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. The command starts the Socket.IO server on port 3001 and the Vite client on port 5173. Vite proxies `/socket.io` to the server, matching the same-origin production connection. Use separate terminals with `npm run dev:server` and `npm run dev:client` when independent logs are useful.

## Commands

```sh
npm run dev          # client and server with reload
npm run build        # shared package, production client, production server
npm start            # serve the built client and Socket.IO on one port
npm test             # unit and integration tests once
npm run test:watch   # tests in watch mode
npm run typecheck
npm run lint
npm run check        # typecheck, lint, tests, and production build
```

`npm start` requires `npm run build` first. It refuses to listen unless the client `index.html` and its referenced JavaScript bundle are present, then listens on `PORT` (default `3001`), serves `/health`, serves client assets with SPA fallback, and hosts Socket.IO on the same origin.

Environment variables are documented in [`.env.example`](.env.example). They are runtime shell variables; the server does not load dotenv files. `CLIENT_ORIGIN` is only needed to permit a separate browser origin. Production clients normally use the service origin. `CLIENT_DIST_PATH` overrides the built client directory and must point to a complete production build containing `index.html` and its referenced JavaScript bundle. For a non-default development server address, put `VITE_DEV_SERVER_URL` in `packages/client/.env` before starting Vite.

## Current playable scope

- Create, join, and reconnect to server-hosted lobbies for 3–8 players.
- Start a game when every player is connected.
- Secret simultaneous connection-card selection and reveal.
- Mutual player connections, exclusive exoplanet connections, and pause follow-up resolution.
- Played-card exhaustion and self-connection card reset.
- Advance through repeated connection-selection rounds.

Module and factory production rules are documented and planned, but are not implemented in the app. Trade rewards, failed-connection compensation, economy, scoring, the board, the wider turn loop, and the end game remain unresolved. The app displays these limits rather than inventing rules.

## Persistence and service limits

All lobbies, games, sessions, and reconnect state are held in one server process:

- A restart or redeploy clears every active game.
- Run one application instance. Multiple replicas do not share rooms or sessions.
- A waiting lobby expires after 2 hours. A lobby with every player disconnected expires after 30 minutes.
- The process accepts up to 1,000 active lobbies, 32 socket connections per IP address, and 10 lobby creations per IP address per minute.
- Reconnect credentials live in the player's browser storage. Losing them loses access to that seat.

These bounds are abuse guards for the first deploy, not a capacity guarantee. Durable games or horizontal scaling require a shared persistence/session design.

## Deploy

The Docker image builds the React client and TypeScript server, then runs one production HTTP service as a non-root user. Its runtime stage installs only the server and shared workspaces' production dependencies; the browser client is copied as static files.

```sh
docker build -t stargate-inc .
docker run --rm -p 3001:3001 -e PORT=3001 stargate-inc
curl --fail http://localhost:3001/health
```

Deploy the image to any platform that supports a long-running container and WebSockets. Route one public HTTP service to `PORT`; no separate static host or Socket.IO URL is needed. Configure the platform health check as `GET /health`. Keep the instance count at one while state remains in memory.

Without Docker:

```sh
npm ci
npm run build
PORT=3001 npm start
```

## Rulebook sync contract

[`packages/shared/src/features.ts`](packages/shared/src/features.ts) is the feature manifest and source of truth for the in-app rulebook. The client renders its playable, planned, and unresolved entries directly; game code also exports the playable feature IDs.

Any feature change must update the manifest in the same change as the implementation and update [`packages/shared/src/features.test.ts`](packages/shared/src/features.test.ts) plus affected engine, server, or UI tests. A feature is marked `playable` only when its rule text matches shipped behavior and automated coverage. Undefined behavior stays `unresolved`; do not fill gaps only in UI copy or separate documentation.

The broader design archive remains under [`docs/`](docs/index.html). When a feature becomes playable, update any overlapping human rule documents as part of that same change so they do not contradict the manifest.
