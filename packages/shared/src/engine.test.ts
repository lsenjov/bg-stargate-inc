import { describe, expect, it } from "vitest";

import {
  GameRuleError,
  constructModule,
  createGame,
  exoplanetCardId,
  pauseCardId,
  playerCardId,
  startNextRound,
  submitInitialSelection,
  submitPauseSelection,
  toPublicGameState,
  undoInitialSelection,
  undoPauseSelection,
} from "./engine.js";
import type {
  ConnectionRewardLocation,
  GameSetup,
  GameState,
  PlayerId,
} from "./model.js";
import { startingModuleId } from "./modules.js";

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

function withConnectionReward(
  state: GameState,
  playerId: PlayerId,
  location: ConnectionRewardLocation,
): GameState {
  state.phase = "connection-rewards";
  state.connectionRewards[playerId] = {
    location,
    stage: "construction",
    completedFactoryIds: [],
    activeFactory: null,
  };
  return state;
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
    expect(game.players.a?.resources).toEqual({
      dollars: 20,
      energy: 6,
      food: 1,
      ore: 0,
      metal: 8,
      mre: 2,
      teams: 0,
    });
    expect(game.players.a?.heldModules).toHaveLength(6);
    expect(game.players.a?.homeFactories).toEqual([]);
    expect(game.exoplanets[0]).toMatchObject({
      factorySlots: [null, null, null],
      moduleDeck: [],
      moduleDiscard: [],
    });
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

  it("supports player IDs that overlap object prototype properties", () => {
    const playerIds = ["__proto__", "constructor", "toString"];
    const created = createGame(setup(playerIds));

    expect(Object.getPrototypeOf(created.players)).toBeNull();
    expect(playerIds.every((playerId) => Object.hasOwn(created.players, playerId)))
      .toBe(true);
    expectRuleError(
      () =>
        submitInitialSelection(
          created,
          "valueOf",
          playerCardId("valueOf", "valueOf"),
        ),
      "unknown-player",
    );

    let game = submitInitialSelection(
      created,
      "__proto__",
      pauseCardId("__proto__"),
    );
    game = submitInitialSelection(
      game,
      "constructor",
      playerCardId("constructor", "constructor"),
    );
    game = submitInitialSelection(
      game,
      "toString",
      playerCardId("toString", "toString"),
    );

    expect(game.round.phase).toBe("pause-selection");
    expect(Object.getPrototypeOf(game.round.initialSelections)).toBeNull();
    expect(Object.getPrototypeOf(game.round.revealedInitialSelections)).toBeNull();

    game = submitPauseSelection(
      game,
      "__proto__",
      playerCardId("__proto__", "__proto__"),
    );

    expect(game.round.phase).toBe("resolved");
    expect(Object.getPrototypeOf(game.round.pauseSelections)).toBeNull();
    expect(Object.getPrototypeOf(game.round.revealedPauseSelections)).toBeNull();
    expect(Object.getPrototypeOf(game.round.resolution?.playerResults)).toBeNull();
    for (const playerId of playerIds) {
      expect(Object.hasOwn(game.round.resolution!.playerResults, playerId))
        .toBe(true);
      expect(game.round.resolution?.playerResults[playerId]).toMatchObject({
        status: "connected",
      });
    }

    const publicState = toPublicGameState(game);
    expect(Object.getPrototypeOf(publicState.players)).toBeNull();
    expect(publicState.round.initialSelectionsSubmittedBy).toEqual(playerIds);
    expect(publicState.round.pauseSelectionsSubmittedBy).toEqual(["__proto__"]);
    expect(
      Object.getPrototypeOf(publicState.round.revealedInitialSelections),
    ).toBeNull();
    expect(Object.getPrototypeOf(publicState.round.revealedPauseSelections))
      .toBeNull();
    expect(Object.getPrototypeOf(publicState.round.resolution?.playerResults))
      .toBeNull();
  });
});

describe("module construction", () => {
  it("constructs held modules permanently in ordered home factories", () => {
    const original = withConnectionReward(
      createGame(setup()),
      "a",
      { kind: "home", playerId: "a" },
    );
    const solarId = startingModuleId("a", "solar-farm");
    const farmId = startingModuleId("a", "farm");
    const withSolar = constructModule(original, "a", solarId, {
      kind: "new-factory",
    });
    const factoryId = withSolar.players.a!.homeFactories[0]!.id;
    const withFarm = constructModule(withSolar, "a", farmId, {
      kind: "factory",
      factoryId,
    });

    expect(original.players.a?.homeFactories).toEqual([]);
    expect(original.players.a?.resources.metal).toBe(8);
    expect(withFarm.players.a?.homeFactories).toEqual([
      {
        id: factoryId,
        type: "rural",
        modules: [
          { id: solarId, definitionId: "solar-farm", ownerId: "a" },
          { id: farmId, definitionId: "farm", ownerId: "a" },
        ],
      },
    ]);
    expect(withFarm.players.a?.resources).toMatchObject({
      metal: 6,
      energy: 4,
    });
    expect(withFarm.players.a?.heldModules.map(({ id }) => id)).not.toContain(
      solarId,
    );
  });

  it("rejects mismatched factories and unavailable held modules", () => {
    const game = withConnectionReward(
      createGame(setup()),
      "a",
      { kind: "home", playerId: "a" },
    );
    const withSolar = constructModule(
      game,
      "a",
      startingModuleId("a", "solar-farm"),
      { kind: "new-factory" },
    );
    const factoryId = withSolar.players.a!.homeFactories[0]!.id;

    expectRuleError(
      () =>
        constructModule(
          withSolar,
          "a",
          startingModuleId("a", "mine"),
          { kind: "factory", factoryId },
        ),
      "factory-type-mismatch",
    );
    expectRuleError(
      () =>
        constructModule(
          withSolar,
          "a",
          startingModuleId("a", "solar-farm"),
          { kind: "new-factory" },
        ),
      "module-unavailable",
    );
  });

  it("uses fixed exoplanet slots, charges a Team, and marks ownership", () => {
    const game = withConnectionReward(
      createGame(setup()),
      "a",
      { kind: "exoplanet", exoplanetId: "earth" },
    );
    game.players.a!.resources.teams = 1;
    const solarId = startingModuleId("a", "solar-farm");
    const built = constructModule(game, "a", solarId, {
      kind: "exoplanet-slot",
      slotIndex: 1,
    });

    expect(built.exoplanets[0]?.factorySlots).toEqual([
      null,
      {
        id: "factory:exoplanet:earth:1",
        type: "rural",
        modules: [
          { id: solarId, definitionId: "solar-farm", ownerId: "a" },
        ],
      },
      null,
    ]);
    expect(built.players.a?.resources).toMatchObject({ metal: 7, teams: 0 });
    expectRuleError(
      () =>
        constructModule(built, "a", startingModuleId("a", "farm"), {
          kind: "exoplanet-slot",
          slotIndex: 1,
        }),
      "factory-slot-unavailable",
    );
  });

  it("keeps economy and factory state in the public game view", () => {
    const game = withConnectionReward(
      createGame(setup()),
      "a",
      { kind: "home", playerId: "a" },
    );
    const built = constructModule(
      game,
      "a",
      startingModuleId("a", "solar-farm"),
      { kind: "new-factory" },
    );
    const publicState = toPublicGameState(built);

    expect(publicState.players.a?.resources).toEqual(
      built.players.a?.resources,
    );
    expect(publicState.players.a?.homeFactories).toEqual(
      built.players.a?.homeFactories,
    );
    expect(publicState.players.a).not.toHaveProperty("reconnectToken");
    expect(publicState.players.a).not.toHaveProperty("hand");
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

  it("undoes a hidden choice without changing either input state", () => {
    const original = createGame(setup());
    const selected = submitInitialSelection(
      submitInitialSelection(original, "a", playerCardId("a", "b")),
      "b",
      playerCardId("b", "a"),
    );
    const undone = undoInitialSelection(selected, "a");

    expect(original.round.initialSelections).toEqual({});
    expect(selected.round.initialSelections.a?.id).toBe(playerCardId("a", "b"));
    expect(selected.round.initialSelections.b?.id).toBe(playerCardId("b", "a"));
    expect(Object.hasOwn(undone.round.initialSelections, "a")).toBe(false);
    expect(undone.round.initialSelections.b?.id).toBe(playerCardId("b", "a"));
    expect(undone.players.a?.hand).toEqual(selected.players.a?.hand);
    expect(toPublicGameState(undone).round.initialSelectionsSubmittedBy).toEqual([
      "b",
    ]);
  });

  it("allows a new initial choice after undo", () => {
    const selected = submitInitialSelection(
      createGame(setup()),
      "a",
      playerCardId("a", "b"),
    );
    const undone = undoInitialSelection(selected, "a");
    const reselected = submitInitialSelection(
      undone,
      "a",
      exoplanetCardId("a", "earth"),
    );

    expect(reselected.round.initialSelections.a?.id).toBe(
      exoplanetCardId("a", "earth"),
    );
  });

  it("rejects initial undo without a submitted choice or after reveal", () => {
    const game = createGame(setup());
    expectRuleError(
      () => undoInitialSelection(game, "a"),
      "selection-not-submitted",
    );

    const pausePhase = chooseInitial(game, {
      a: pauseCardId("a"),
      b: playerCardId("b", "b"),
      c: playerCardId("c", "c"),
    });
    expectRuleError(
      () => undoInitialSelection(pausePhase, "a"),
      "wrong-phase",
    );
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

  it("undoes a hidden follow-up without changing its input state", () => {
    const initial = chooseInitial(createGame(setup()), {
      a: pauseCardId("a"),
      b: pauseCardId("b"),
      c: playerCardId("c", "c"),
    });
    const selected = submitPauseSelection(
      initial,
      "a",
      playerCardId("a", "b"),
    );
    const undone = undoPauseSelection(selected, "a");

    expect(initial.round.pauseSelections).toEqual({});
    expect(selected.round.pauseSelections.a?.id).toBe(playerCardId("a", "b"));
    expect(Object.hasOwn(undone.round.pauseSelections, "a")).toBe(false);
    expect(undone.round.revealedInitialSelections).toEqual(
      selected.round.revealedInitialSelections,
    );
    expect(undone.players.a?.hand).toEqual(selected.players.a?.hand);
    expect(toPublicGameState(undone).round.pauseSelectionsSubmittedBy).toEqual(
      [],
    );
  });

  it("allows a new pause follow-up after undo", () => {
    const initial = chooseInitial(createGame(setup()), {
      a: pauseCardId("a"),
      b: pauseCardId("b"),
      c: playerCardId("c", "c"),
    });
    const selected = submitPauseSelection(
      initial,
      "a",
      playerCardId("a", "b"),
    );
    const undone = undoPauseSelection(selected, "a");
    const reselected = submitPauseSelection(
      undone,
      "a",
      exoplanetCardId("a", "earth"),
    );

    expect(reselected.round.pauseSelections.a?.id).toBe(
      exoplanetCardId("a", "earth"),
    );
  });

  it("rejects pause undo for missing, ineligible, and wrong-phase players", () => {
    const game = createGame(setup());
    expectRuleError(() => undoPauseSelection(game, "a"), "wrong-phase");

    const pausePhase = chooseInitial(game, {
      a: pauseCardId("a"),
      b: pauseCardId("b"),
      c: playerCardId("c", "c"),
    });
    expectRuleError(
      () => undoPauseSelection(pausePhase, "a"),
      "selection-not-submitted",
    );
    expectRuleError(
      () => undoPauseSelection(pausePhase, "c"),
      "player-did-not-pause",
    );
  });
});

describe("selection undo record safety", () => {
  it("removes prototype-named initial and pause choices from null records", () => {
    const created = createGame(setup(["__proto__", "constructor", "toString"]));
    const initialSelected = submitInitialSelection(
      created,
      "__proto__",
      pauseCardId("__proto__"),
    );
    const initialUndone = undoInitialSelection(initialSelected, "__proto__");

    expect(Object.hasOwn(initialSelected.round.initialSelections, "__proto__"))
      .toBe(true);
    expect(Object.hasOwn(initialUndone.round.initialSelections, "__proto__"))
      .toBe(false);
    expect(Object.getPrototypeOf(initialUndone.round.initialSelections)).toBeNull();

    let pausePhase = submitInitialSelection(
      initialUndone,
      "__proto__",
      pauseCardId("__proto__"),
    );
    pausePhase = submitInitialSelection(
      pausePhase,
      "constructor",
      pauseCardId("constructor"),
    );
    pausePhase = submitInitialSelection(
      pausePhase,
      "toString",
      playerCardId("toString", "toString"),
    );
    const pauseSelected = submitPauseSelection(
      pausePhase,
      "__proto__",
      playerCardId("__proto__", "constructor"),
    );
    const pauseUndone = undoPauseSelection(pauseSelected, "__proto__");

    expect(Object.hasOwn(pauseSelected.round.pauseSelections, "__proto__"))
      .toBe(true);
    expect(Object.hasOwn(pauseUndone.round.pauseSelections, "__proto__"))
      .toBe(false);
    expect(Object.getPrototypeOf(pauseUndone.round.pauseSelections)).toBeNull();
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
