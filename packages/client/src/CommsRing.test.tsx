// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  startingResources,
  type CommandResult,
  type GestureEvent,
  type LobbyView,
} from "@stargate-inc/shared";

import { CommsRing } from "./CommsRing.js";
import type { GameSocket } from "./socket.js";
import "./testStorage.js";

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

function publicGamePlayer(player: (typeof players)[keyof typeof players]) {
  return {
    ...player,
    handSize: 0,
    playedCards: [],
    resources: { ...startingResources },
    heldModules: [],
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
        phase: "connection-round",
        connectionRewards: {},
        playerOrder: ["p1", "p2", "p3"],
        exoplanets: [
          exoplanet("alpha", "Exoplanet Alpha"),
          exoplanet("beta", "Exoplanet Beta"),
        ],
        players: {
          p1: publicGamePlayer(players.p1),
          p2: publicGamePlayer(players.p2),
          p3: publicGamePlayer(players.p3),
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
    selectionDeadlineAt: null,
  };
}

function maxTargetView(): LobbyView {
  const current = view(true);
  const maxPlayers = Object.fromEntries(Array.from({ length: 8 }, (_, index) => {
    const id = `p${index + 1}`;
    return [id, { id, name: `Player ${index + 1}`, connected: true }];
  }));
  const playerOrder = Object.keys(maxPlayers);
  return {
    ...current,
    lobby: {
      ...current.lobby,
      players: maxPlayers,
      game: {
        ...current.lobby.game!,
        playerOrder,
        exoplanets: Array.from({ length: 4 }, (_, index) => exoplanet(`exo-${index + 1}`, `Exoplanet ${index + 1}`)),
        players: Object.fromEntries(playerOrder.map((id) => [id, publicGamePlayer(maxPlayers[id] as (typeof players)[keyof typeof players])])),
      },
    },
  };
}

function mockOrbitSize(width: number, height: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, width, height));
}

function elementPoint(element: HTMLElement, width: number, height: number): { x: number; y: number } {
  return {
    x: Number.parseFloat(element.style.left) * width / 100,
    y: Number.parseFloat(element.style.top) * height / 100,
  };
}

function linePoint(line: SVGLineElement, end: "start" | "end", width: number, height: number): { x: number; y: number } {
  return {
    x: Number(line.getAttribute(end === "start" ? "x1" : "x2")) * width / 100,
    y: Number(line.getAttribute(end === "start" ? "y1" : "y2")) * height / 100,
  };
}

function distance(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
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
  window.localStorage.clear();
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

  it("places the gesture beside its sender and starts the line beyond the badge", () => {
    const socket = new FakeSocket();
    render(<CommsRing socket={asSocket(socket)} view={view()} disabled={false} onError={vi.fn()} />);

    act(() => socket.serverEmit("gesture:received", gesture({ senderPlayerId: "p1", target: { kind: "player", playerId: "p2" }, gesture: "wave" })));

    const badge = document.querySelector<HTMLElement>(".gesture-signal-badge");
    const line = document.querySelector<SVGLineElement>(".gesture-signal line");
    expect(badge).not.toBeNull();
    expect(line).not.toBeNull();
    const badgeLeft = Number.parseFloat(badge?.style.left ?? "");
    const badgeTop = Number.parseFloat(badge?.style.top ?? "");
    const lineStartX = Number(line?.getAttribute("x1"));
    const lineEndX = Number(line?.getAttribute("x2"));

    expect(badgeLeft).toBeGreaterThan(31);
    expect(badgeLeft).toBeLessThan(50);
    expect(badgeTop).toBeGreaterThan(82);
    expect(lineStartX).toBeLessThan(badgeLeft);
    expect(lineEndX).toBeGreaterThan(12);
    expect(screen.getByRole("button", { name: "Gesture to Vega, player" }).closest(".comms-target")?.classList.contains("receiving")).toBe(true);
  });

  it("separates concurrent gestures on the same route", () => {
    const socket = new FakeSocket();
    render(<CommsRing socket={asSocket(socket)} view={view()} disabled={false} onError={vi.fn()} />);

    act(() => {
      socket.serverEmit("gesture:received", gesture());
      socket.serverEmit("gesture:received", gesture({ id: "gesture-2", gesture: "wave" }));
    });

    const badges = Array.from(document.querySelectorAll<HTMLElement>(".gesture-signal-badge"));
    expect(badges).toHaveLength(2);
    expect(document.querySelectorAll(".gesture-signal")).toHaveLength(2);
    expect(badges[0]?.style.left).not.toBe(badges[1]?.style.left);
    expect(badges[0]?.style.top).not.toBe(badges[1]?.style.top);
  });

  it("preserves badge and beacon-core anchor clearances in a measured narrow orbit", () => {
    const width = 320;
    const height = 470;
    mockOrbitSize(width, height);
    const socket = new FakeSocket();
    render(<CommsRing socket={asSocket(socket)} view={view()} disabled={false} onError={vi.fn()} />);

    act(() => socket.serverEmit("gesture:received", gesture({ senderPlayerId: "p1", target: { kind: "player", playerId: "p2" } })));

    const badge = document.querySelector<HTMLElement>(".gesture-signal-badge")!;
    const line = document.querySelector<SVGLineElement>(".gesture-signal line")!;
    const sender = document.querySelector<HTMLElement>(".comms-self")!;
    const target = screen.getByRole("button", { name: "Gesture to Vega, player" }).closest<HTMLElement>(".comms-target")!;
    const badgePoint = elementPoint(badge, width, height);
    const senderPoint = elementPoint(sender, width, height);
    const targetPoint = elementPoint(target, width, height);

    expect(distance(badgePoint, senderPoint)).toBeCloseTo(44, 5);
    expect(distance(linePoint(line, "start", width, height), badgePoint)).toBeCloseTo(18, 5);
    expect(distance(linePoint(line, "end", width, height), targetPoint)).toBeCloseTo(29, 5);
  });

  it("uses a perpendicular badge route between adjacent targets at maximum ring capacity", () => {
    const width = 140;
    const height = 470;
    mockOrbitSize(width, height);
    const socket = new FakeSocket();
    render(<CommsRing socket={asSocket(socket)} view={maxTargetView()} disabled={false} onError={vi.fn()} />);

    act(() => socket.serverEmit("gesture:received", gesture({ senderPlayerId: "p7", target: { kind: "player", playerId: "p8" } })));

    const badge = document.querySelector<HTMLElement>(".gesture-signal-badge");
    const line = document.querySelector<SVGLineElement>(".gesture-signal line");
    expect(badge).not.toBeNull();
    expect(line).not.toBeNull();
    const sender = screen.getByRole("button", { name: "Gesture to Player 7, player" }).closest<HTMLElement>(".comms-target")!;
    const target = screen.getByRole("button", { name: "Gesture to Player 8, player" }).closest<HTMLElement>(".comms-target")!;
    const badgePoint = elementPoint(badge!, width, height);
    const senderPoint = elementPoint(sender, width, height);
    const targetPoint = elementPoint(target, width, height);
    const route = { x: targetPoint.x - senderPoint.x, y: targetPoint.y - senderPoint.y };
    const badgeOffset = { x: badgePoint.x - senderPoint.x, y: badgePoint.y - senderPoint.y };

    expect(distance(badgePoint, senderPoint)).toBeGreaterThan(44);
    expect(distance(badgePoint, targetPoint)).toBeGreaterThanOrEqual(53);
    expect(Math.abs(route.x * badgeOffset.x + route.y * badgeOffset.y)).toBeLessThan(.001);
    expect(distance(linePoint(line!, "start", width, height), linePoint(line!, "end", width, height))).toBeGreaterThanOrEqual(6);
  });

  it("avoids badge collisions for concurrent gestures from one sender to different targets", () => {
    const width = 320;
    const height = 470;
    mockOrbitSize(width, height);
    const socket = new FakeSocket();
    render(<CommsRing socket={asSocket(socket)} view={maxTargetView()} disabled={false} onError={vi.fn()} />);

    act(() => {
      socket.serverEmit("gesture:received", gesture({ senderPlayerId: "p1", target: { kind: "player", playerId: "p2" } }));
      socket.serverEmit("gesture:received", gesture({ id: "gesture-2", senderPlayerId: "p1", target: { kind: "player", playerId: "p3" } }));
    });

    const badges = Array.from(document.querySelectorAll<HTMLElement>(".gesture-signal-badge"));
    expect(badges).toHaveLength(2);
    expect(distance(elementPoint(badges[0]!, width, height), elementPoint(badges[1]!, width, height))).toBeGreaterThanOrEqual(35);
  });

  it("keeps a non-adjacent route badge clear of an intervening beacon", () => {
    const width = 268;
    const height = 470;
    mockOrbitSize(width, height);
    const socket = new FakeSocket();
    render(<CommsRing socket={asSocket(socket)} view={maxTargetView()} disabled={false} onError={vi.fn()} />);

    act(() => socket.serverEmit("gesture:received", gesture({ senderPlayerId: "p3", target: { kind: "player", playerId: "p5" } })));

    const badge = document.querySelector<HTMLElement>(".gesture-signal-badge");
    expect(badge).not.toBeNull();
    const intervening = screen.getByRole("button", { name: "Gesture to Player 4, player" }).closest<HTMLElement>(".comms-target")!;

    expect(distance(elementPoint(badge!, width, height), elementPoint(intervening, width, height))).toBeGreaterThanOrEqual(44);
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

    expect(window.localStorage.getItem("stargate-inc-gestures-muted-v1")).toBe("true");
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
