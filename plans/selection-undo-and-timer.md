# Selection undo and timer

## Goal

Let players withdraw a locked initial or pause selection while its phase remains open. Give each selection phase a server-authoritative 30-second deadline; when it expires, submit each missing player's self card automatically.

## Step 1: Engine and protocol

- Add immutable engine operations for undoing an initial selection or pause follow-up before reveal.
- Reject undo for the wrong phase, an ineligible pause player, or a player without a submitted choice.
- Add a strict `selection:undo` command and expose the active selection deadline in `LobbyView` without putting wall-clock state in the deterministic engine.
- Add engine and protocol coverage.
- Commit.

## Step 2: Server deadlines and automatic self-selection

- Add a configurable selection duration that defaults to 30 seconds.
- Start a deadline when the game starts, when an initial reveal enters pause selection, and when the next round starts.
- Preserve the current deadline across ordinary submissions, undo, broadcasts, and reconnects.
- At expiry, submit the self card for every missing eligible player through the existing engine operations, then start a fresh deadline if resolution enters pause selection.
- Clear obsolete timers on phase changes and lobby deletion; make timeout callbacks harmless after replacement or cleanup.
- Handle `selection:undo` through the authenticated session and broadcast the updated private/public views.
- Add integration coverage for initial and pause expiry, undo/reselection, deadline stability, reconnect, race-safe cleanup, and invalid commands.
- Commit.

## Step 3: Player interface

- Show a synchronized countdown for active initial and pause selection phases.
- Let a submitted eligible player undo their selection while the phase remains open, then choose again.
- Communicate expiry and automatic self-selection through existing phase/results UI and accessible live status.
- Keep countdown updates local between authoritative server views and handle reduced motion, offline state, and narrow screens.
- Add client coverage for countdown display, undo, reselection, phase changes, deadline expiry, and StrictMode lifecycle cleanup.
- Commit.

## Step 4: Feature manifest and verification

- Document selection undo and timed automatic self-selection as playable rules in the shared feature manifest.
- Run the full repository check and final review.
- Commit.

## Deliberate limits

- Undo is unavailable after a phase reveals or resolves.
- A deadline never resets because a player submits, undoes, disconnects, or reconnects.
- Timer expiry has no grace period beyond normal server event-loop ordering.
