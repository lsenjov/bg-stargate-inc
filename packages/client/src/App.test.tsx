// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createStartingModules,
  gameFeatures,
  startingResources,
  type CommandResult,
  type LobbyView,
  type SessionData,
} from "@stargate-inc/shared";

import { App } from "./App.js";
import type { GameSocket } from "./socket.js";
import "./testStorage.js";

type Listener = (...args: never[]) => void;

class FakeSocket {
  connected = true;
  handlers = new Map<string, Set<Listener>>();
  managerHandlers = new Map<string, Set<Listener>>();
  commands: Array<{ event: string; payload: unknown }> = [];
  responses = new Map<string, CommandResult<unknown>>();
  callbacks = new Map<string, (result: CommandResult<unknown>) => void>();
  io = {
    on: (event: string, listener: Listener) => this.add(this.managerHandlers, event, listener),
    off: (event: string, listener: Listener) => this.remove(this.managerHandlers, event, listener),
  };

  on(event: string, listener: Listener) { this.add(this.handlers, event, listener); return this; }
  off(event: string, listener: Listener) { this.remove(this.handlers, event, listener); return this; }
  disconnect() { this.connected = false; return this; }
  connect() {
    this.connected = true;
    this.serverEmit("connect");
    return this;
  }
  emit(event: string, payload: unknown, callback?: (result: CommandResult<unknown>) => void) {
    this.commands.push({ event, payload });
    if (callback) this.callbacks.set(event, callback);
    const response = this.responses.get(event);
    if (response && callback) callback(response);
    return this;
  }
  serverEmit(event: string, ...args: unknown[]) {
    for (const listener of this.handlers.get(event) ?? []) listener(...(args as never[]));
  }
  private add(map: Map<string, Set<Listener>>, event: string, listener: Listener) {
    const listeners = map.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    map.set(event, listeners);
  }
  private remove(map: Map<string, Set<Listener>>, event: string, listener: Listener) { map.get(event)?.delete(listener); }
}

const playerIds = ["p1", "p2", "p3"];
const lobbyPlayers = {
  p1: { id: "p1", name: "Nova", connected: true },
  p2: { id: "p2", name: "Vega", connected: true },
  p3: { id: "p3", name: "Orion", connected: true },
};

function publicGamePlayer(player: (typeof lobbyPlayers)[keyof typeof lobbyPlayers]) {
  return {
    ...player,
    handSize: 4,
    playedCards: [],
    resources: { ...startingResources },
    heldModules: createStartingModules(player.id),
    homeFactories: [],
  };
}

function exoplanet(id: string, name: string) {
  return {
    id,
    name,
    factorySlots: [null, null, null],
    moduleDeck: [],
    moduleDiscard: [],
  };
}

function waitingView(): LobbyView {
  return {
    lobby: {
      id: "lobby-one",
      joinCode: "ABCDEFGHJK",
      hostPlayerId: "p1",
      status: "waiting",
      players: lobbyPlayers,
      game: null,
    },
    self: { playerId: "p1", hand: null, initialSelectionCardId: null, pauseSelectionCardId: null },
    selectionDeadlineAt: null,
  };
}

function gameView(phase: "initial-selection" | "pause-selection" | "resolved" = "initial-selection"): LobbyView {
  const initialCards = {
    p1: { id: "player:p1:p2", kind: "player" as const, ownerId: "p1", targetPlayerId: "p2" },
    p2: { id: "player:p2:p1", kind: "player" as const, ownerId: "p2", targetPlayerId: "p1" },
    p3: { id: "exoplanet:p3:alpha", kind: "exoplanet" as const, ownerId: "p3", targetExoplanetId: "alpha" },
  };
  const hand = [
    initialCards.p1,
    { id: "player:p1:p1", kind: "player" as const, ownerId: "p1", targetPlayerId: "p1" },
    { id: "exoplanet:p1:alpha", kind: "exoplanet" as const, ownerId: "p1", targetExoplanetId: "alpha" },
    { id: "pause:p1", kind: "pause" as const, ownerId: "p1" },
  ];
  const resolution = phase === "resolved" ? {
    connections: [
      { kind: "player" as const, playerIds: ["p1", "p2"] as const, step: "initial" as const },
      { kind: "exoplanet" as const, playerId: "p3", exoplanetId: "alpha", step: "initial" as const },
    ],
    playerResults: {
      p1: { status: "connected" as const, connection: { kind: "player" as const, playerIds: ["p1", "p2"] as const, step: "initial" as const } },
      p2: { status: "connected" as const, connection: { kind: "player" as const, playerIds: ["p1", "p2"] as const, step: "initial" as const } },
      p3: { status: "connected" as const, connection: { kind: "exoplanet" as const, playerId: "p3", exoplanetId: "alpha", step: "initial" as const } },
    },
    unresolvedEffects: [{ kind: "trade" as const, playerIds: ["p1", "p2"] as const }],
  } : null;
  return {
    lobby: {
      id: "lobby-one", joinCode: "ABCDEFGHJK", hostPlayerId: "p1", status: "playing", players: lobbyPlayers,
      game: {
        id: "game-one", phase: "connection-round", connectionRewards: {}, playerOrder: playerIds, exoplanets: [exoplanet("alpha", "Exoplanet Alpha"), exoplanet("beta", "Exoplanet Beta")],
        players: {
          p1: { ...publicGamePlayer(lobbyPlayers.p1), handSize: hand.length },
          p2: publicGamePlayer(lobbyPlayers.p2),
          p3: publicGamePlayer(lobbyPlayers.p3),
        },
        round: {
          number: 1, phase, initialSelectionsSubmittedBy: phase === "initial-selection" ? [] : playerIds,
          revealedInitialSelections: phase === "initial-selection" ? null : initialCards,
          pausePlayerIds: [], pauseSelectionsSubmittedBy: [], revealedPauseSelections: null, resolution,
        },
      },
    },
    self: { playerId: "p1", hand, initialSelectionCardId: null, pauseSelectionCardId: null },
    selectionDeadlineAt: phase === "resolved" ? null : Date.now() + 30_000,
  };
}

function factoryRewardView(stage: "construction" | "production"): LobbyView {
  const view = gameView("resolved");
  const game = view.lobby.game!;
  game.phase = "connection-rewards";
  game.connectionRewards = {
    p1: {
      location: { kind: "home", playerId: "p1" },
      stage,
      completedFactoryIds: [],
      activeFactory: null,
    },
  };
  if (stage === "production") {
    const solar = game.players.p1!.heldModules.find(
      ({ definitionId }) => definitionId === "solar-farm",
    )!;
    const farm = game.players.p1!.heldModules.find(
      ({ definitionId }) => definitionId === "farm",
    )!;
    game.players.p1!.heldModules = game.players.p1!.heldModules.filter(
      ({ id }) => id !== solar.id && id !== farm.id,
    );
    game.players.p1!.resources = {
      ...game.players.p1!.resources,
      energy: 4,
      metal: 6,
    };
    game.players.p1!.homeFactories = [
      {
        id: "factory:home:p1:0",
        type: "rural",
        modules: [{ ...solar, ownerId: "p1" }],
      },
      {
        id: "factory:home:p1:1",
        type: "rural",
        modules: [{ ...farm, ownerId: "p1" }],
      },
    ];
  }
  return view;
}

function sessionData(state: LobbyView, reconnectToken = "token"): SessionData {
  return { state, reconnectToken };
}

function asSocket(fake: FakeSocket): GameSocket {
  return fake as unknown as GameSocket;
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("player app", () => {
  it("creates a lobby, stores the reconnect session, and starts as host", async () => {
    const user = userEvent.setup();
    const socket = new FakeSocket();
    socket.responses.set("lobby:create", { ok: true, data: sessionData(waitingView()) });
    socket.responses.set("game:start", { ok: true, data: gameView() });
    render(<App socket={asSocket(socket)} />);

    await user.type(screen.getAllByLabelText("Your callsign", { selector: "input" })[0]!, "Nova");
    await user.click(screen.getByRole("button", { name: /create lobby/i }));

    expect(await screen.findByText("ABCDEFGHJK")).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem("stargate-inc-session-v1") ?? "{}")).toMatchObject({ lobbyId: "lobby-one", playerId: "p1" });
    await user.click(screen.getByRole("button", { name: /start game · 3 players/i }));
    expect(socket.commands.some(({ event }) => event === "game:start")).toBe(true);
  });

  it("reconnects to a private hand and submits a secret selection", async () => {
    window.localStorage.setItem("stargate-inc-session-v1", JSON.stringify({ lobbyId: "lobby-one", playerId: "p1", reconnectToken: "token" }));
    const socket = new FakeSocket();
    socket.responses.set("lobby:reconnect", { ok: true, data: sessionData(gameView()) });
    socket.responses.set("selection:initial", { ok: true, data: gameView() });
    render(<App socket={asSocket(socket)} />);

    const hand = await screen.findByRole("heading", { name: "Your hand" });
    const handPanel = hand.closest("section");
    expect(handPanel).toBeTruthy();
    const vegaCard = within(handPanel as HTMLElement).getByRole("button", { name: /Vega/i });
    fireEvent.click(vegaCard);
    expect(socket.commands).toContainEqual({ event: "selection:initial", payload: { cardId: "player:p1:p2" } });
  });

  it("counts down the initial selection deadline and stops local actions at zero", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const view = gameView();
    window.localStorage.setItem("stargate-inc-session-v1", JSON.stringify({ lobbyId: "lobby-one", playerId: "p1", reconnectToken: "token" }));
    const socket = new FakeSocket();
    socket.responses.set("lobby:reconnect", { ok: true, data: sessionData(view) });
    render(<App socket={asSocket(socket)} />);

    expect(screen.getByRole("timer", { name: "30 seconds remaining" }).textContent).toContain("0:30");
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.getByRole("timer", { name: "10 seconds remaining" }).textContent).toContain("0:10");
    act(() => vi.advanceTimersByTime(10_000));

    expect(screen.getByRole("timer", { name: "Selection time expired" }).textContent).toContain("0:00");
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.getByText(/server will connect any player without a locked choice to themself/i)).toBeTruthy();
    const handPanel = screen.getByRole("heading", { name: "Your hand" }).closest("section")!;
    const vegaCard = within(handPanel).getByRole("button", { name: /Vega/i }) as HTMLButtonElement;
    expect(vegaCard.disabled).toBe(true);
    fireEvent.click(vegaCard);
    expect(socket.commands.some(({ event }) => event === "selection:initial")).toBe(false);
  });

  it("resynchronizes the timer when the phase or authoritative deadline changes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const initial = gameView();
    window.localStorage.setItem("stargate-inc-session-v1", JSON.stringify({ lobbyId: "lobby-one", playerId: "p1", reconnectToken: "token" }));
    const socket = new FakeSocket();
    socket.responses.set("lobby:reconnect", { ok: true, data: sessionData(initial) });
    render(<App socket={asSocket(socket)} />);

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("timer", { name: "28 seconds remaining" })).toBeTruthy();

    const pause = gameView("pause-selection");
    pause.lobby.game!.round.pausePlayerIds = ["p1"];
    act(() => socket.serverEmit("lobby:state", pause));
    expect(screen.getByRole("heading", { name: "Choose after the pause" })).toBeTruthy();
    expect(screen.getByRole("timer", { name: "30 seconds remaining" })).toBeTruthy();

    const corrected = structuredClone(pause);
    corrected.selectionDeadlineAt = Date.now() + 12_000;
    act(() => socket.serverEmit("lobby:state", corrected));
    expect(screen.getByRole("timer", { name: "12 seconds remaining" })).toBeTruthy();
  });

  it("undoes a locked choice and allows another selection in the same phase", () => {
    const submitted = gameView();
    submitted.self.initialSelectionCardId = "player:p1:p2";
    submitted.lobby.game!.round.initialSelectionsSubmittedBy = ["p1"];
    window.localStorage.setItem("stargate-inc-session-v1", JSON.stringify({ lobbyId: "lobby-one", playerId: "p1", reconnectToken: "token" }));
    const socket = new FakeSocket();
    socket.responses.set("lobby:reconnect", { ok: true, data: sessionData(submitted) });
    socket.responses.set("selection:undo", { ok: true, data: submitted });
    socket.responses.set("selection:initial", { ok: true, data: submitted });
    render(<App socket={asSocket(socket)} />);

    const undoButton = screen.getByRole("button", { name: "Undo selection" });
    undoButton.focus();
    fireEvent.click(undoButton);
    expect(socket.commands).toContainEqual({ event: "selection:undo", payload: {} });

    const undone = gameView();
    undone.selectionDeadlineAt = submitted.selectionDeadlineAt;
    act(() => socket.serverEmit("lobby:state", undone));
    const handPanel = screen.getByRole("heading", { name: "Your hand" }).closest("section")!;
    const alphaCard = within(handPanel).getByRole("button", { name: /Exoplanet Alpha/i });
    expect(document.activeElement).toBe(within(handPanel).getByRole("button", { name: /Vega/i }));
    expect((alphaCard as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(alphaCard);
    expect(socket.commands).toContainEqual({ event: "selection:initial", payload: { cardId: "exoplanet:p1:alpha" } });
  });

  it("undoes and replaces a pause follow-up without offering the Pause card", () => {
    const submitted = gameView("pause-selection");
    submitted.lobby.game!.round.pausePlayerIds = ["p1"];
    submitted.lobby.game!.round.pauseSelectionsSubmittedBy = ["p1"];
    submitted.self.initialSelectionCardId = "pause:p1";
    submitted.self.pauseSelectionCardId = "player:p1:p2";
    window.localStorage.setItem("stargate-inc-session-v1", JSON.stringify({ lobbyId: "lobby-one", playerId: "p1", reconnectToken: "token" }));
    const socket = new FakeSocket();
    socket.responses.set("lobby:reconnect", { ok: true, data: sessionData(submitted) });
    socket.responses.set("selection:undo", { ok: true, data: submitted });
    socket.responses.set("selection:pause", { ok: true, data: submitted });
    render(<App socket={asSocket(socket)} />);

    fireEvent.click(screen.getByRole("button", { name: "Undo selection" }));
    const undone = structuredClone(submitted);
    undone.lobby.game!.round.pauseSelectionsSubmittedBy = [];
    undone.self.pauseSelectionCardId = null;
    act(() => socket.serverEmit("lobby:state", undone));

    const handPanel = screen.getByRole("heading", { name: "Your hand" }).closest("section")!;
    expect(within(handPanel).queryByRole("button", { name: /Pause/i })).toBeNull();
    fireEvent.click(within(handPanel).getByRole("button", { name: /Vega/i }));
    expect(socket.commands).toContainEqual({ event: "selection:pause", payload: { cardId: "player:p1:p2" } });
  });

  it("keeps a locked choice and reports an undo rejection", () => {
    const submitted = gameView("pause-selection");
    submitted.lobby.game!.round.pausePlayerIds = ["p1"];
    submitted.lobby.game!.round.pauseSelectionsSubmittedBy = ["p1"];
    submitted.self.pauseSelectionCardId = "player:p1:p2";
    window.localStorage.setItem("stargate-inc-session-v1", JSON.stringify({ lobbyId: "lobby-one", playerId: "p1", reconnectToken: "token" }));
    const socket = new FakeSocket();
    socket.responses.set("lobby:reconnect", { ok: true, data: sessionData(submitted) });
    socket.responses.set("selection:undo", { ok: false, error: { code: "wrong-phase", message: "Selection is already revealed" } });
    render(<App socket={asSocket(socket)} />);

    fireEvent.click(screen.getByRole("button", { name: "Undo selection" }));
    expect(screen.getByRole("alert").textContent).toContain("Selection is already revealed");
    expect(screen.getByText("✓ Selection locked")).toBeTruthy();
  });

  it("disables undo while pending and while offline", () => {
    const submitted = gameView();
    submitted.self.initialSelectionCardId = "player:p1:p2";
    submitted.lobby.game!.round.initialSelectionsSubmittedBy = ["p1"];
    window.localStorage.setItem("stargate-inc-session-v1", JSON.stringify({ lobbyId: "lobby-one", playerId: "p1", reconnectToken: "token" }));
    const socket = new FakeSocket();
    socket.responses.set("lobby:reconnect", { ok: true, data: sessionData(submitted) });
    render(<App socket={asSocket(socket)} />);

    fireEvent.click(screen.getByRole("button", { name: "Undo selection" }));
    expect((screen.getByRole("button", { name: "Undoing…" }) as HTMLButtonElement).disabled).toBe(true);

    act(() => socket.callbacks.get("selection:undo")?.({ ok: true, data: submitted }));
    socket.connected = false;
    act(() => socket.serverEmit("disconnect"));
    expect((screen.getByRole("button", { name: "Undo selection" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("cleans the countdown interval during StrictMode replay and unmount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const view = gameView();
    window.localStorage.setItem("stargate-inc-session-v1", JSON.stringify({ lobbyId: "lobby-one", playerId: "p1", reconnectToken: "token" }));
    const socket = new FakeSocket();
    socket.responses.set("lobby:reconnect", { ok: true, data: sessionData(view) });

    const rendered = render(<StrictMode><App socket={asSocket(socket)} /></StrictMode>);
    expect(screen.getByRole("timer", { name: "30 seconds remaining" })).toBeTruthy();
    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    rendered.unmount();
    const intervalHandles = setIntervalSpy.mock.results.map(({ value }) => value);
    expect(clearIntervalSpy.mock.calls.map(([handle]) => handle)).toEqual(intervalHandles);
  });

  it("shows resolved results, unresolved reward scope, and starts the next round", async () => {
    window.localStorage.setItem("stargate-inc-session-v1", JSON.stringify({ lobbyId: "lobby-one", playerId: "p1", reconnectToken: "token" }));
    const socket = new FakeSocket();
    socket.responses.set("lobby:reconnect", { ok: true, data: sessionData(gameView("resolved")) });
    socket.responses.set("round:next", { ok: true, data: gameView() });
    render(<App socket={asSocket(socket)} />);

    expect(await screen.findByText("Connection report")).toBeTruthy();
    expect(screen.getByLabelText("Round resolved").textContent).toContain("DONE");
    expect(screen.getByText("Some rewards remain unresolved")).toBeTruthy();
    expect(screen.getByText(
      "Factory actions are playable after self and exoplanet connections. Trade and failed-connection compensation are not yet defined.",
    )).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /next round/i }));
    expect(socket.commands.some(({ event }) => event === "round:next")).toBe(true);
  });

  it("constructs held modules into a chosen factory target", async () => {
    window.localStorage.setItem("stargate-inc-session-v1", JSON.stringify({ lobbyId: "lobby-one", playerId: "p1", reconnectToken: "token" }));
    const view = factoryRewardView("construction");
    const socket = new FakeSocket();
    socket.responses.set("lobby:reconnect", { ok: true, data: sessionData(view) });
    socket.responses.set("factory:construct", { ok: true, data: view });
    socket.responses.set("production:begin", { ok: true, data: view });
    render(<App socket={asSocket(socket)} />);

    expect(await screen.findByRole("heading", { name: "Build at your home planet" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /next round/i })).toBeNull();
    expect((screen.getByLabelText("Factory target for Solar Farm") as HTMLSelectElement).value).toBe("new-factory");
    fireEvent.click(screen.getByRole("button", { name: "Construct Solar Farm" }));
    expect(socket.commands).toContainEqual({
      event: "factory:construct",
      payload: {
        moduleId: "module:p1:solar-farm",
        target: { kind: "new-factory" },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue to production/i }));
    expect(socket.commands.some(({ event }) => event === "production:begin")).toBe(true);
  });

  it("falls back when a selected exoplanet slot becomes a factory", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("stargate-inc-session-v1", JSON.stringify({ lobbyId: "lobby-one", playerId: "p1", reconnectToken: "token" }));
    const view = factoryRewardView("construction");
    const game = view.lobby.game!;
    game.connectionRewards.p1!.location = { kind: "exoplanet", exoplanetId: "alpha" };
    game.players.p1!.resources.teams = 2;
    const socket = new FakeSocket();
    socket.responses.set("lobby:reconnect", { ok: true, data: sessionData(view) });
    socket.responses.set("factory:construct", { ok: true, data: view });
    render(<App socket={asSocket(socket)} />);

    const solarTarget = await screen.findByLabelText("Factory target for Solar Farm") as HTMLSelectElement;
    const farmTarget = screen.getByLabelText("Factory target for Farm") as HTMLSelectElement;
    fireEvent.change(solarTarget, { target: { value: "slot:1" } });
    fireEvent.change(farmTarget, { target: { value: "slot:1" } });
    await user.click(screen.getByRole("button", { name: "Construct Solar Farm" }));

    const updated = structuredClone(view);
    const updatedGame = updated.lobby.game!;
    const solar = updatedGame.players.p1!.heldModules.find(({ definitionId }) => definitionId === "solar-farm")!;
    updatedGame.players.p1!.heldModules = updatedGame.players.p1!.heldModules.filter(({ id }) => id !== solar.id);
    updatedGame.exoplanets[0]!.factorySlots[1] = {
      id: "factory:exoplanet:alpha:1",
      type: "rural",
      modules: [{ ...solar, ownerId: "p1" }],
    };
    act(() => socket.serverEmit("lobby:state", updated));

    expect((screen.getByLabelText("Factory target for Farm") as HTMLSelectElement).value).toBe("factory:factory:exoplanet:alpha:1");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Construct Farm" }));
    fireEvent.click(screen.getByRole("button", { name: "Construct Farm" }));
    expect(socket.commands.at(-1)).toEqual({
      event: "factory:construct",
      payload: {
        moduleId: "module:p1:farm",
        target: { kind: "factory", factoryId: "factory:exoplanet:alpha:1" },
      },
    });
  });

  it("lets the player choose the next factory multiplier and finish production", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("stargate-inc-session-v1", JSON.stringify({ lobbyId: "lobby-one", playerId: "p1", reconnectToken: "token" }));
    const view = factoryRewardView("production");
    const socket = new FakeSocket();
    socket.responses.set("lobby:reconnect", { ok: true, data: sessionData(view) });
    socket.responses.set("production:run", { ok: true, data: view });
    socket.responses.set("connection:finish", { ok: true, data: view });
    render(<App socket={asSocket(socket)} />);

    expect(await screen.findByRole("heading", { name: "Operate your home planet" })).toBeTruthy();
    const farmCard = screen.getByText("Farm", { selector: ".factory-run-card li strong" }).closest("article");
    expect(farmCard).toBeTruthy();
    await user.click(within(farmCard as HTMLElement).getByRole("button", { name: "Run Farm in factory 2 at 1x" }));
    expect(socket.commands).toContainEqual({
      event: "production:run",
      payload: { factoryId: "factory:home:p1:1" },
    });
    const updated = structuredClone(view);
    updated.lobby.game!.connectionRewards.p1!.completedFactoryIds = ["factory:home:p1:1"];
    act(() => socket.serverEmit("lobby:state", updated));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Run Solar Farm in factory 1 at 2x" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish connection" }));
    expect(socket.commands.some(({ event }) => event === "connection:finish")).toBe(true);
    expect(screen.getByRole("heading", { name: "Factories and balances" })).toBeTruthy();
  });

  it("renders every rulebook item and its manifest status", async () => {
    const user = userEvent.setup();
    const socket = new FakeSocket();
    render(<App socket={asSocket(socket)} />);
    await user.click(screen.getAllByRole("button", { name: "Rulebook" })[0]!);

    const dialog = screen.getByRole("dialog", { name: "What you can play" });
    for (const feature of gameFeatures) {
      expect(within(dialog).getByText(feature.name)).toBeTruthy();
    }
    expect(within(dialog).getByText("Current feature scope")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("traps rulebook focus and restores the opener after Escape", async () => {
    const user = userEvent.setup();
    const socket = new FakeSocket();
    render(<App socket={asSocket(socket)} />);
    const opener = screen.getAllByRole("button", { name: "Rulebook" })[0]!;

    await user.click(opener);
    const close = screen.getByRole("button", { name: "Close rulebook" });
    expect(document.activeElement).toBe(close);
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(close);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("keeps another tab's rotated session and reconnects before returning home", async () => {
    const previousSession = {
      lobbyId: "lobby-one",
      playerId: "p1",
      reconnectToken: "previous-token",
    };
    window.localStorage.setItem("stargate-inc-session-v1", JSON.stringify(previousSession));
    const socket = new FakeSocket();
    socket.responses.set(
      "lobby:reconnect",
      { ok: true, data: sessionData(waitingView(), "owned-rotated-token") },
    );
    render(<App socket={asSocket(socket)} />);
    await screen.findByText("ABCDEFGHJK");

    const otherTabSession = { ...previousSession, reconnectToken: "other-tab-token" };
    window.localStorage.setItem("stargate-inc-session-v1", JSON.stringify(otherTabSession));
    socket.connected = false;
    socket.serverEmit("disconnect");
    socket.serverEmit("session:replaced");

    expect(await screen.findByText("Seat moved")).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem("stargate-inc-session-v1") ?? "{}"))
      .toEqual(otherTabSession);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Return home" }));

    const callsign = (await screen.findAllByLabelText("Your callsign", { selector: "input" }))[0]!;
    await user.type(callsign, "Altair");
    expect((screen.getByRole("button", { name: /create lobby/i }) as HTMLButtonElement).disabled).toBe(false);
    expect(socket.connected).toBe(true);
  });

  it("keeps a newer shared session when a stale reconnect fails", async () => {
    const staleSession = {
      lobbyId: "stale-lobby",
      playerId: "stale-player",
      reconnectToken: "stale-token",
    };
    window.localStorage.setItem("stargate-inc-session-v1", JSON.stringify(staleSession));
    const socket = new FakeSocket();
    render(<App socket={asSocket(socket)} />);
    expect(socket.commands).toContainEqual({
      event: "lobby:reconnect",
      payload: staleSession,
    });

    const newerSession = {
      lobbyId: "new-lobby",
      playerId: "new-player",
      reconnectToken: "new-token",
    };
    window.localStorage.setItem("stargate-inc-session-v1", JSON.stringify(newerSession));
    act(() => {
      socket.callbacks.get("lobby:reconnect")?.({
        ok: false,
        error: { code: "invalid-credentials", message: "Reconnect credentials are invalid" },
      });
    });

    expect(JSON.parse(window.localStorage.getItem("stargate-inc-session-v1") ?? "{}"))
      .toEqual(newerSession);
    expect(screen.getByText(/saved game is no longer available/i)).toBeTruthy();
    expect(screen.getByRole("heading", { name: /build the connection/i })).toBeTruthy();
  });

  it("shows the pause follow-up rather than the initial pause as selected", async () => {
    const view = gameView("pause-selection");
    view.lobby.game!.round.pausePlayerIds = ["p1"];
    view.lobby.game!.round.pauseSelectionsSubmittedBy = ["p1"];
    view.self.initialSelectionCardId = "pause:p1";
    view.self.pauseSelectionCardId = "player:p1:p2";
    window.localStorage.setItem("stargate-inc-session-v1", JSON.stringify({ lobbyId: "lobby-one", playerId: "p1", reconnectToken: "token" }));
    const socket = new FakeSocket();
    socket.responses.set("lobby:reconnect", { ok: true, data: sessionData(view) });
    render(<App socket={asSocket(socket)} />);

    const vega = await screen.findByRole("button", { name: /Vega.*Locked/i });
    expect(vega.classList.contains("selected")).toBe(true);
  });
});
