// @vitest-environment jsdom

import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  type Listener = (...args: never[]) => void;
  const handlers = new Map<string, Set<Listener>>();
  const managerHandlers = new Map<string, Set<Listener>>();
  const add = (
    map: Map<string, Set<Listener>>,
    event: string,
    listener: Listener,
  ) => {
    const listeners = map.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    map.set(event, listeners);
  };
  const remove = (
    map: Map<string, Set<Listener>>,
    event: string,
    listener: Listener,
  ) => map.get(event)?.delete(listener);
  const socket = {
    connected: false,
    io: {
      on: vi.fn((event: string, listener: Listener) =>
        add(managerHandlers, event, listener)),
      off: vi.fn((event: string, listener: Listener) =>
        remove(managerHandlers, event, listener)),
    },
    on: vi.fn((event: string, listener: Listener) => {
      add(handlers, event, listener);
      return socket;
    }),
    off: vi.fn((event: string, listener: Listener) => {
      remove(handlers, event, listener);
      return socket;
    }),
    emit: vi.fn(() => socket),
    connect: vi.fn(() => {
      socket.connected = true;
      for (const listener of handlers.get("connect") ?? []) listener();
      return socket;
    }),
    disconnect: vi.fn(() => {
      socket.connected = false;
      return socket;
    }),
  };
  return { createGameSocket: vi.fn(() => socket), socket };
});

vi.mock("./socket.js", () => ({
  createGameSocket: harness.createGameSocket,
}));

import { App } from "./App.js";
import "./testStorage.js";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("app socket lifecycle", () => {
  it("reconnects the same app-owned socket after StrictMode effect replay", async () => {
    render(<StrictMode><App /></StrictMode>);

    await waitFor(() => expect(screen.getByText("Online")).toBeTruthy());
    expect(harness.createGameSocket).toHaveBeenCalledTimes(1);
    expect(harness.socket.connect).toHaveBeenCalledTimes(2);
    expect(harness.socket.disconnect).toHaveBeenCalledTimes(1);
  });
});
