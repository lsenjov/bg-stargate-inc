// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  gameFeatures,
  type CommandResult,
  type LobbyView,
  type SessionData,
} from "@stargate-inc/shared";

import { App } from "./App.js";
import type { GameSocket } from "./socket.js";

type Listener = (...args: never[]) => void;

class FakeSocket {
  connected = true;
  handlers = new Map<string, Set<Listener>>();
  managerHandlers = new Map<string, Set<Listener>>();
  commands: Array<{ event: string; payload: unknown }> = [];
  responses = new Map<string, CommandResult<unknown>>();
  io = {
    on: (event: string, listener: Listener) => this.add(this.managerHandlers, event, listener),
    off: (event: string, listener: Listener) => this.remove(this.managerHandlers, event, listener),
  };

  on(event: string, listener: Listener) { this.add(this.handlers, event, listener); return this; }
  off(event: string, listener: Listener) { this.remove(this.handlers, event, listener); return this; }
  disconnect() { this.connected = false; return this; }
  emit(event: string, payload: unknown, callback?: (result: CommandResult<unknown>) => void) {
    this.commands.push({ event, payload });
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
        id: "game-one", playerOrder: playerIds, exoplanets: [{ id: "alpha", name: "Exoplanet Alpha" }, { id: "beta", name: "Exoplanet Beta" }],
        players: {
          p1: { ...lobbyPlayers.p1, handSize: hand.length, playedCards: [] },
          p2: { ...lobbyPlayers.p2, handSize: 4, playedCards: [] },
          p3: { ...lobbyPlayers.p3, handSize: 4, playedCards: [] },
        },
        round: {
          number: 1, phase, initialSelectionsSubmittedBy: phase === "initial-selection" ? [] : playerIds,
          revealedInitialSelections: phase === "initial-selection" ? null : initialCards,
          pausePlayerIds: [], pauseSelectionsSubmittedBy: [], revealedPauseSelections: null, resolution,
        },
      },
    },
    self: { playerId: "p1", hand, initialSelectionCardId: null, pauseSelectionCardId: null },
  };
}

function sessionData(state: LobbyView): SessionData {
  return { state, reconnectToken: "token" };
}

function asSocket(fake: FakeSocket): GameSocket {
  return fake as unknown as GameSocket;
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
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
    expect(JSON.parse(localStorage.getItem("stargate-inc-session-v1") ?? "{}")).toMatchObject({ lobbyId: "lobby-one", playerId: "p1" });
    await user.click(screen.getByRole("button", { name: /start game · 3 players/i }));
    expect(socket.commands.some(({ event }) => event === "game:start")).toBe(true);
  });

  it("reconnects to a private hand and submits a secret selection", async () => {
    localStorage.setItem("stargate-inc-session-v1", JSON.stringify({ lobbyId: "lobby-one", playerId: "p1", reconnectToken: "token" }));
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

  it("shows resolved results, unresolved reward scope, and starts the next round", async () => {
    localStorage.setItem("stargate-inc-session-v1", JSON.stringify({ lobbyId: "lobby-one", playerId: "p1", reconnectToken: "token" }));
    const socket = new FakeSocket();
    socket.responses.set("lobby:reconnect", { ok: true, data: sessionData(gameView("resolved")) });
    socket.responses.set("round:next", { ok: true, data: gameView() });
    render(<App socket={asSocket(socket)} />);

    expect(await screen.findByText("Connection report")).toBeTruthy();
    expect(screen.getByText("Reward step not yet playable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /next round/i }));
    expect(socket.commands.some(({ event }) => event === "round:next")).toBe(true);
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
    expect(within(dialog).getByText(/rewards, economy, scoring, board play/i)).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
