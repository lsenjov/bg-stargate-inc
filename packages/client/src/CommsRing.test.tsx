// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type CommandResult,
  type GestureEvent,
  type LobbyView,
} from "@stargate-inc/shared";

import { CommsRing } from "./CommsRing.js";
import type { GameSocket } from "./socket.js";

type Listener = (...args: never[]) => void;

class FakeSocket {
  handlers = new Map<string, Set<Listener>>();
  commands: Array<{ event: string; payload: unknown }> = [];
  response: CommandResult<GestureEvent> | null = null;
  callback: ((result: CommandResult<GestureEvent>) => void) | null = null;

  on(event: string, listener: Listener) {
    const listeners = this.handlers.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.handlers.set(event, listeners);
    return this;
  }

  off(event: string, listener: Listener) {
    this.handlers.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, payload: unknown, callback: (result: CommandResult<GestureEvent>) => void) {
    this.commands.push({ event, payload });
    this.callback = callback;
    if (this.response) callback(this.response);
    return this;
  }

  serverEmit(event: string, ...args: unknown[]) {
    for (const listener of this.handlers.get(event) ?? []) listener(...(args as never[]));
  }
}

const players = {
  p1: { id: "p1", name: "Nova", connected: true },
  p2: { id: "p2", name: "Vega", connected: true },
  p3: { id: "p3", name: "Orion", connected: false },
};

function view(playing = false): LobbyView {
  return {
    lobby: {
      id: "lobby",
      joinCode: "ABCDEFGHJK",
      hostPlayerId: "p1",
      status: playing ? "playing" : "waiting",
      players,
      game: playing ? {
        id: "game",
        playerOrder: ["p1", "p2", "p3"],
        exoplanets: [
          { id: "alpha", name: "Exoplanet Alpha" },
          { id: "beta", name: "Exoplanet Beta" },
        ],
        players: {
          p1: { ...players.p1, handSize: 0, playedCards: [] },
          p2: { ...players.p2, handSize: 0, playedCards: [] },
          p3: { ...players.p3, handSize: 0, playedCards: [] },
        },
        round: {
          number: 1,
          phase: "initial-selection",
          initialSelectionsSubmittedBy: [],
          revealedInitialSelections: null,
          pausePlayerIds: [],
          pauseSelectionsSubmittedBy: [],
          revealedPauseSelections: null,
          resolution: null,
        },
      } : null,
    },
    self: {
      playerId: "p1",
      hand: playing ? [] : null,
      initialSelectionCardId: null,
      pauseSelectionCardId: null,
    },
  };
}

function asSocket(socket: FakeSocket): GameSocket {
  return socket as unknown as GameSocket;
}

function gesture(overrides: Partial<GestureEvent> = {}): GestureEvent {
  return {
    id: "gesture-1",
    senderPlayerId: "p2",
    target: { kind: "player", playerId: "p1" },
    gesture: "nod",
    sentAt: 10,
    ...overrides,
  } as GestureEvent;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Comms Ring", () => {
  it("sends player gestures and waits for the public server event before rendering", () => {
    const socket = new FakeSocket();
    socket.response = { ok: true, data: gesture({ senderPlayerId: "p1", target: { kind: "player", playerId: "p2" }, gesture: "wave" }) };
    render(<CommsRing socket={asSocket(socket)} view={view()} disabled={false} onError={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Gesture to Vega, player" }));
    const menu = screen.getByRole("group", { name: "Choose gesture for Vega" });
    expect(within(menu).getByRole("button", { name: "Beckon to Vega" })).toBeTruthy();
    fireEvent.click(within(menu).getByRole("button", { name: "Wave to Vega" }));

    expect(socket.commands).toContainEqual({
      event: "gesture:send",
      payload: { target: { kind: "player", playerId: "p2" }, gesture: "wave" },
    });
    expect(document.querySelector(".gesture-signal")).toBeNull();

    act(() => socket.serverEmit("gesture:received", gesture({ senderPlayerId: "p1", target: { kind: "player", playerId: "p2" }, gesture: "wave" })));
    expect(document.querySelectorAll(".gesture-signal")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("Nova waves to Vega.");
  });

  it("offers only exoplanet gestures and sends the typed exoplanet target", () => {
    const socket = new FakeSocket();
    socket.response = { ok: true, data: gesture({ target: { kind: "exoplanet", exoplanetId: "alpha" }, gesture: "point" }) };
    render(<CommsRing socket={asSocket(socket)} view={view(true)} disabled={false} onError={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Gesture to Exoplanet Alpha, exoplanet" }));
    const menu = screen.getByRole("group", { name: "Choose gesture for Exoplanet Alpha" });
    expect(within(menu).getByRole("button", { name: "Point to Exoplanet Alpha" })).toBeTruthy();
    expect(within(menu).queryByRole("button", { name: "Wave to Exoplanet Alpha" })).toBeNull();
    fireEvent.click(within(menu).getByRole("button", { name: "Point to Exoplanet Alpha" }));

    expect(socket.commands).toContainEqual({
      event: "gesture:send",
      payload: { target: { kind: "exoplanet", exoplanetId: "alpha" }, gesture: "point" },
    });
  });

  it("expires received signals", () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    render(<CommsRing socket={asSocket(socket)} view={view()} disabled={false} onError={vi.fn()} />);

    act(() => socket.serverEmit("gesture:received", gesture()));
    expect(document.querySelectorAll(".gesture-signal")).toHaveLength(1);
    act(() => vi.advanceTimersByTime(4_000));
    expect(document.querySelector(".gesture-signal")).toBeNull();
  });

  it("persists mute and suppresses incoming signals and announcements", () => {
    const socket = new FakeSocket();
    const rendered = render(<CommsRing socket={asSocket(socket)} view={view()} disabled={false} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Mute gestures" }));

    expect(localStorage.getItem("stargate-inc-gestures-muted-v1")).toBe("true");
    act(() => socket.serverEmit("gesture:received", gesture()));
    expect(document.querySelector(".gesture-signal")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Gestures muted.");

    rendered.unmount();
    render(<CommsRing socket={asSocket(new FakeSocket())} view={view()} disabled={false} onError={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Gestures muted" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps one listener under StrictMode and removes it on unmount", () => {
    const socket = new FakeSocket();
    const rendered = render(<StrictMode><CommsRing socket={asSocket(socket)} view={view()} disabled={false} onError={vi.fn()} /></StrictMode>);

    expect(socket.handlers.get("gesture:received")?.size).toBe(1);
    act(() => socket.serverEmit("gesture:received", gesture()));
    expect(document.querySelectorAll(".gesture-signal")).toHaveLength(1);
    rendered.unmount();
    expect(socket.handlers.get("gesture:received")?.size).toBe(0);
  });

  it("labels all targets, excludes self as a target, and disables disconnected players", () => {
    render(<CommsRing socket={asSocket(new FakeSocket())} view={view(true)} disabled={false} onError={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /Gesture to Nova/ })).toBeNull();
    expect(screen.getByText("Nova")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gesture to Vega, player" })).not.toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Gesture to Orion, disconnected player" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Gesture to Exoplanet Beta, exoplanet" })).toBeTruthy();
  });

  it("supports arrow navigation and Escape with focus restoration", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    render(<CommsRing socket={asSocket(new FakeSocket())} view={view()} disabled={false} onError={vi.fn()} />);
    const target = screen.getByRole("button", { name: "Gesture to Vega, player" });

    fireEvent.click(target);
    const beckon = screen.getByRole("button", { name: "Beckon to Vega" });
    const nod = screen.getByRole("button", { name: "Nod to Vega" });
    expect(document.activeElement).toBe(beckon);
    fireEvent.keyDown(beckon, { key: "ArrowRight" });
    expect(document.activeElement).toBe(nod);
    fireEvent.keyDown(nod, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Choose gesture for Vega" })).toBeNull();
    expect(document.activeElement).toBe(target);
  });

  it("restores focus to an enabled target while an acknowledgement is pending", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    const socket = new FakeSocket();
    render(<CommsRing socket={asSocket(socket)} view={view()} disabled={false} onError={vi.fn()} />);
    const target = screen.getByRole("button", { name: "Gesture to Vega, player" });

    fireEvent.click(target);
    fireEvent.click(screen.getByRole("button", { name: "Wave to Vega" }));

    expect(document.activeElement).toBe(target);
    expect(target).not.toHaveProperty("disabled", true);
    expect(target.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(target);
    expect(screen.queryByRole("group", { name: "Choose gesture for Vega" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Waiting for gesture confirmation.");
  });

  it("recovers from a missing acknowledgement with existing error feedback", () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const onError = vi.fn();
    render(<CommsRing socket={asSocket(socket)} view={view()} disabled={false} onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "Gesture to Vega, player" }));
    fireEvent.click(screen.getByRole("button", { name: "Wave to Vega" }));
    act(() => vi.advanceTimersByTime(8_000));

    expect(onError).toHaveBeenLastCalledWith("Gesture confirmation timed out. Check your connection and try again.");
    act(() => socket.callback?.({ ok: false, error: { code: "rate-limited", message: "Late rejection" } }));
    expect(onError).toHaveBeenLastCalledWith("Gesture confirmation timed out. Check your connection and try again.");
    fireEvent.click(screen.getByRole("button", { name: "Gesture to Vega, player" }));
    expect(screen.getByRole("button", { name: "Nod to Vega" })).not.toHaveProperty("disabled", true);
  });

  it("closes an open fan and moves focus when targets become unavailable", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    const socket = new FakeSocket();
    const rendered = render(<CommsRing socket={asSocket(socket)} view={view()} disabled={false} onError={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Gesture to Vega, player" }));
    rendered.rerender(<CommsRing socket={asSocket(socket)} view={view()} disabled onError={vi.fn()} />);

    expect(screen.queryByRole("group", { name: "Choose gesture for Vega" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Mute gestures" }));
  });

  it("reports rejected gestures through the app error channel", () => {
    const socket = new FakeSocket();
    socket.response = { ok: false, error: { code: "rate-limited", message: "Wait before sending another gesture" } };
    const onError = vi.fn();
    render(<CommsRing socket={asSocket(socket)} view={view()} disabled={false} onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "Gesture to Vega, player" }));
    fireEvent.click(screen.getByRole("button", { name: "Nod to Vega" }));
    expect(onError).toHaveBeenLastCalledWith("Wait before sending another gesture");
  });
});
