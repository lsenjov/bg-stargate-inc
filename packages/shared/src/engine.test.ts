import { describe, expect, it } from "vitest";

import {
  GameRuleError,
  createGame,
  exoplanetCardId,
  pauseCardId,
  playerCardId,
  startNextRound,
  submitInitialSelection,
  submitPauseSelection,
  toPublicGameState,
} from "./engine.js";
import type { GameSetup, GameState, PlayerId } from "./model.js";

const exoplanets = [
  { id: "earth", name: "Earth" },
  { id: "mars", name: "Mars" },
];

function setup(playerIds: PlayerId[] = ["a", "b", "c"]): GameSetup {
  return {
    id: "game-1",
    players: playerIds.map((id) => ({
      id,
      name: id.toUpperCase(),
      reconnectToken: `token-${id}`,
    })),
    exoplanets,
  };
}

function chooseInitial(
  state: GameState,
  choices: Record<PlayerId, string>,
): GameState {
  return state.playerOrder.reduce(
    (next, playerId) =>
      submitInitialSelection(next, playerId, choices[playerId]!),
    state,
  );
}

function choosePause(
  state: GameState,
  choices: Record<PlayerId, string>,
): GameState {
  return state.round.pausePlayerIds.reduce(
    (next, playerId) => submitPauseSelection(next, playerId, choices[playerId]!),
    state,
  );
}

function expectRuleError(
  action: () => unknown,
  code: GameRuleError["code"],
): void {
  expect(action).toThrowError(GameRuleError);
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("game setup", () => {
  it("creates each player's complete selection deck and reconnect state", () => {
    const game = createGame(setup());

    expect(game.playerOrder).toEqual(["a", "b", "c"]);
    expect(game.players.a).toMatchObject({
      connected: true,
      reconnectToken: "token-a",
      playedCards: [],
    });
    expect(game.players.a?.hand).toHaveLength(6);
    expect(game.players.a?.hand.map(({ id }) => id)).toEqual([
      playerCardId("a", "a"),
      playerCardId("a", "b"),
      playerCardId("a", "c"),
      exoplanetCardId("a", "earth"),
      exoplanetCardId("a", "mars"),
      pauseCardId("a"),
    ]);
  });

  it.each([
    { players: ["a", "b"], planets: exoplanets },
    { players: ["a", "b", "c"], planets: [exoplanets[0]!] },
  ])("rejects setup outside the playable limits", ({ players, planets }) => {
    expectRuleError(
      () => createGame({ ...setup(players), exoplanets: planets }),
      "invalid-setup",
    );
  });

  it("rejects duplicate IDs and reconnect tokens", () => {
    expectRuleError(
      () => createGame(setup(["a", "a", "c"])),
      "invalid-setup",
    );
    const duplicateTokens = setup();
    duplicateTokens.players[1]!.reconnectToken = "token-a";
    expectRuleError(() => createGame(duplicateTokens), "invalid-setup");
  });
});

describe("initial selection and resolution", () => {
  it("keeps choices hidden and leaves its input state unchanged", () => {
    const original = createGame(setup());
    const next = submitInitialSelection(original, "a", playerCardId("a", "b"));
    const publicState = toPublicGameState(next);

    expect(original.round.initialSelections).toEqual({});
    expect(original.players.a?.hand).toHaveLength(6);
    expect(next.round.initialSelections.a).toMatchObject({
      kind: "player",
      targetPlayerId: "b",
    });
    expect(publicState.round.revealedInitialSelections).toBeNull();
    expect(publicState.round.initialSelectionsSubmittedBy).toEqual(["a"]);
    expect(publicState.round).not.toHaveProperty("initialSelections");
    expect(publicState.players.a).not.toHaveProperty("hand");
    expect(publicState.players.a).not.toHaveProperty("reconnectToken");
    expect(publicState.players.a?.handSize).toBe(6);
  });

  it("connects mutual players and a sole exoplanet claimant", () => {
    const game = chooseInitial(createGame(setup()), {
      a: playerCardId("a", "b"),
      b: playerCardId("b", "a"),
      c: exoplanetCardId("c", "earth"),
    });

    expect(game.round.phase).toBe("resolved");
    expect(game.round.resolution?.connections).toEqual([
      { kind: "player", playerIds: ["a", "b"], step: "initial" },
      {
        kind: "exoplanet",
        playerId: "c",
        exoplanetId: "earth",
        step: "initial",
      },
    ]);
    expect(game.round.resolution?.unresolvedEffects).toEqual([
      { kind: "trade", playerIds: ["a", "b"] },
    ]);
  });

  it("fails non-mutual player choices and records compensation", () => {
    const game = chooseInitial(createGame(setup()), {
      a: playerCardId("a", "b"),
      b: playerCardId("b", "b"),
      c: playerCardId("c", "a"),
    });

    expect(game.round.resolution?.playerResults).toMatchObject({
      a: { status: "failed", reason: "player-choice-not-mutual" },
      b: { status: "connected", connection: { kind: "self" } },
      c: { status: "failed", reason: "player-choice-not-mutual" },
    });
    expect(game.round.resolution?.unresolvedEffects).toEqual([
      { kind: "internal-production", playerId: "b" },
      { kind: "compensation", playerId: "a" },
      { kind: "compensation", playerId: "c" },
    ]);
  });

  it("fails every simultaneous claimant to an exoplanet", () => {
    const game = chooseInitial(createGame(setup()), {
      a: exoplanetCardId("a", "earth"),
      b: exoplanetCardId("b", "earth"),
      c: exoplanetCardId("c", "mars"),
    });

    expect(game.round.resolution?.playerResults).toMatchObject({
      a: { status: "failed", reason: "exoplanet-contested" },
      b: { status: "failed", reason: "exoplanet-contested" },
      c: { status: "connected" },
    });
  });

  it("exhausts played cards across rounds and restores all cards on self-connection", () => {
    const first = chooseInitial(createGame(setup()), {
      a: exoplanetCardId("a", "earth"),
      b: playerCardId("b", "b"),
      c: exoplanetCardId("c", "mars"),
    });
    const secondStart = startNextRound(first);

    expect(secondStart.players.a?.playedCards.map(({ id }) => id)).toEqual([
      exoplanetCardId("a", "earth"),
    ]);
    expectRuleError(
      () =>
        submitInitialSelection(
          secondStart,
          "a",
          exoplanetCardId("a", "earth"),
        ),
      "card-unavailable",
    );

    const second = chooseInitial(secondStart, {
      a: playerCardId("a", "a"),
      b: exoplanetCardId("b", "earth"),
      c: playerCardId("c", "c"),
    });
    expect(second.players.a?.playedCards).toEqual([]);
    expect(second.players.a?.hand).toHaveLength(6);
    expect(second.players.a?.hand.map(({ id }) => id)).toContain(
      exoplanetCardId("a", "earth"),
    );
  });
});

describe("pause follow-up", () => {
  it("reveals initial choices before keeping the follow-up hidden", () => {
    let game = chooseInitial(createGame(setup()), {
      a: playerCardId("a", "b"),
      b: pauseCardId("b"),
      c: playerCardId("c", "c"),
    });

    expect(game.round.phase).toBe("pause-selection");
    expect(game.round.revealedInitialSelections).toMatchObject({
      a: { kind: "player", targetPlayerId: "b" },
      b: { kind: "pause" },
    });
    game = submitPauseSelection(game, "b", playerCardId("b", "a"));
    const publicState = toPublicGameState(game);

    expect(publicState.round.pauseSelectionsSubmittedBy).toEqual(["b"]);
    expect(publicState.round).not.toHaveProperty("pauseSelections");
    expect(game.round.resolution?.connections).toContainEqual({
      kind: "player",
      playerIds: ["a", "b"],
      step: "pause",
    });
  });

  it("connects pause players who choose each other", () => {
    const initial = chooseInitial(createGame(setup()), {
      a: pauseCardId("a"),
      b: pauseCardId("b"),
      c: playerCardId("c", "c"),
    });
    const game = choosePause(initial, {
      a: playerCardId("a", "b"),
      b: playerCardId("b", "a"),
    });

    expect(game.round.resolution?.connections).toContainEqual({
      kind: "player",
      playerIds: ["a", "b"],
      step: "pause",
    });
  });

  it("lets a sole pause claimant take an initially contested exoplanet", () => {
    const initial = chooseInitial(createGame(setup()), {
      a: exoplanetCardId("a", "earth"),
      b: exoplanetCardId("b", "earth"),
      c: pauseCardId("c"),
    });
    const game = choosePause(initial, {
      c: exoplanetCardId("c", "earth"),
    });

    expect(game.round.resolution?.playerResults).toMatchObject({
      a: { status: "failed", reason: "exoplanet-contested" },
      b: { status: "failed", reason: "exoplanet-contested" },
      c: { status: "connected" },
    });
  });

  it("does not let pause displace a successful exoplanet claimant", () => {
    const initial = chooseInitial(createGame(setup()), {
      a: exoplanetCardId("a", "earth"),
      b: playerCardId("b", "b"),
      c: pauseCardId("c"),
    });
    const game = choosePause(initial, {
      c: exoplanetCardId("c", "earth"),
    });

    expect(game.round.resolution?.playerResults.c).toEqual({
      status: "failed",
      reason: "exoplanet-already-claimed",
    });
  });

  it("fails simultaneous pause claimants to the same exoplanet", () => {
    const initial = chooseInitial(createGame(setup(["a", "b", "c", "d"])), {
      a: exoplanetCardId("a", "earth"),
      b: exoplanetCardId("b", "earth"),
      c: pauseCardId("c"),
      d: pauseCardId("d"),
    });
    const game = choosePause(initial, {
      c: exoplanetCardId("c", "earth"),
      d: exoplanetCardId("d", "earth"),
    });

    expect(game.round.resolution?.playerResults.c).toEqual({
      status: "failed",
      reason: "exoplanet-contested",
    });
    expect(game.round.resolution?.playerResults.d).toEqual({
      status: "failed",
      reason: "exoplanet-contested",
    });
  });

  it("accepts pause self-selection and consumes both cards before resetting", () => {
    const initial = chooseInitial(createGame(setup()), {
      a: pauseCardId("a"),
      b: playerCardId("b", "b"),
      c: playerCardId("c", "c"),
    });
    const game = choosePause(initial, {
      a: playerCardId("a", "a"),
    });

    expect(game.round.resolution?.playerResults.a).toMatchObject({
      status: "connected",
      connection: { kind: "self", step: "pause" },
    });
    expect(game.players.a?.playedCards).toEqual([]);
    expect(game.players.a?.hand).toHaveLength(6);
  });
});

describe("command validation and determinism", () => {
  it("rejects duplicate, out-of-phase, and unauthorized selections", () => {
    const game = createGame(setup());
    const selected = submitInitialSelection(game, "a", pauseCardId("a"));
    expectRuleError(
      () => submitInitialSelection(selected, "a", playerCardId("a", "a")),
      "choice-already-submitted",
    );

    const withB = submitInitialSelection(
      selected,
      "b",
      playerCardId("b", "b"),
    );
    const pausePhase = submitInitialSelection(
      withB,
      "c",
      playerCardId("c", "c"),
    );
    expectRuleError(
      () => submitPauseSelection(pausePhase, "b", playerCardId("b", "a")),
      "player-did-not-pause",
    );
    expectRuleError(
      () => submitInitialSelection(pausePhase, "b", playerCardId("b", "a")),
      "wrong-phase",
    );
  });

  it("produces byte-identical state from the same ordered commands", () => {
    const play = () =>
      chooseInitial(createGame(setup()), {
        a: playerCardId("a", "b"),
        b: playerCardId("b", "a"),
        c: exoplanetCardId("c", "mars"),
      });

    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
  });
});
