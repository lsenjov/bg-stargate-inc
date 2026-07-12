# Gestures

## Goal

Add a public, transient Comms Ring where authenticated players can gesture at other connected players or the current game's exoplanets without typing or changing deterministic game state.

## Step 1: Gesture protocol and server authority

- Define fixed player and exoplanet gesture kinds, typed targets, strict command validation, and transient server events in the shared protocol.
- Authenticate the sender from the socket session; validate lobby membership, target availability, and game availability for exoplanet targets.
- Rate-limit gestures by lobby/player so reconnecting cannot bypass the limit.
- Broadcast accepted gestures only to connected members of the sender's lobby; do not persist or replay them.
- Add shared/server tests for malformed input, authorization, cross-lobby targets, exoplanet targets, rate limiting, and broadcast scope.
- Commit.

## Step 2: Comms Ring interface

- Add a persistent Comms Ring to waiting and playing screens with player beacons and, during play, exoplanet nodes.
- Let players choose a target and send a fixed gesture from a contextual radial-style menu.
- Render short-lived directional signals from sender to target without a gesture log or optimistic duplicate.
- Support keyboard operation, live-region announcements, reduced motion, local gesture muting, responsive layout, and server error feedback.
- Add client tests for player and exoplanet gestures, incoming events, expiry, mute, and accessibility labels.
- Commit.

## Step 3: Feature manifest and verification

- Mark public gestures playable in the shared feature manifest and describe their non-binding, public behavior.
- Run the full repository check.
- Commit.

## Deliberate limits

- No arbitrary text, custom gestures, private gestures, history, reconnect replay, scoring effects, or rule-engine effects.
- Gesture combinations and audio remain follow-up work.
