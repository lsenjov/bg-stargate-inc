# Online multiplayer MVP

## Goal

Ship a deployable, server-authoritative web app for the currently playable connection-selection rules. Keep implemented rules and the player-facing rulebook tied to one feature manifest.

## Step 1: Foundation and rule engine

- Scaffold TypeScript workspaces for shared game logic, the real-time server, and the React client.
- Model lobbies, players, cards, round phases, hidden choices, pause follow-ups, resolution outcomes, and reconnect tokens.
- Implement and test the deterministic connection-selection engine.
- Define the playable/planned feature manifest used by both game code and rulebook UI.
- Add repository checks and developer commands.
- Commit.

## Step 2: Online game flow

- Add server-authoritative Socket.IO lobby creation, joining, starting, selection, pause selection, round resolution, next-round, and reconnection.
- Prevent clients from seeing hidden choices before reveal.
- Add integration coverage for multiplayer flows and invalid commands.
- Commit.

## Step 3: Player UI and synced rulebook

- Build responsive lobby and game screens with secret hand selection, phase status, connection results, played-card tracking, copyable invite details, and reconnect handling.
- Render the in-app rulebook and feature status from the shared manifest.
- Add accessible feedback, loading, empty, and error states.
- Commit.

## Step 4: Deployment and final verification

- Add a production build, container/deployment configuration, environment guidance, and app README.
- Run unit, integration, build, and lint/type checks.
- Review and fix medium/high findings until clear.
- Commit.

## Deliberate limits

- Implements the defined connection-selection round only.
- Trade, internal production rewards, compensation rewards, economy, scoring, board, and end-game stay visibly marked as planned or unresolved.
- In-memory rooms suit the first deploy; restarting the server clears active games.
