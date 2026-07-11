import type { AddressInfo } from "node:net";

import {
  pauseCardId,
  playerCardId,
  type ClientToServerEvents,
  type CommandResult,
  type EmptyCommand,
  type LobbyView,
  type SelectionCommand,
  type ServerToClientEvents,
  type SessionData,
} from "@stargate-inc/shared";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createGameServer,
  type GameServer,
  type GameServerOptions,
} from "./lobby-server.js";

type TestSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

interface PlayerSession extends SessionData {
  socket: TestSocket;
}

let server: GameServer;
let serverUrl: string;
let sockets: TestSocket[];

async function startServer(options: GameServerOptions = {}): Promise<void> {
  server = createGameServer({ corsOrigin: "*", ...options });
  await new Promise<void>((resolve) =>
    server.httpServer.listen(0, "127.0.0.1", resolve),
  );
  const address = server.httpServer.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${address.port}`;
}

async function restartServer(options: GameServerOptions): Promise<void> {
  for (const socket of sockets) {
    socket.disconnect();
  }
  sockets = [];
  await new Promise<void>((resolve) => server.io.close(() => resolve()));
  await startServer(options);
}

function connectClient(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const socket = createClient(serverUrl, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    });
    sockets.push(socket);
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function createLobby(
  socket: TestSocket,
  name: string,
): Promise<CommandResult<SessionData>> {
  return new Promise((resolve) => socket.emit("lobby:create", { name }, resolve));
}

function joinLobby(
  socket: TestSocket,
  joinCode: string,
  name: string,
): Promise<CommandResult<SessionData>> {
  return new Promise((resolve) =>
    socket.emit("lobby:join", { joinCode, name }, resolve),
  );
}

function reconnectLobby(
  socket: TestSocket,
  credentials: {
    lobbyId: string;
    playerId: string;
    reconnectToken: string;
  },
): Promise<CommandResult<SessionData>> {
  return new Promise((resolve) =>
    socket.emit("lobby:reconnect", credentials, resolve),
  );
}

function emptyCommand(
  socket: TestSocket,
  event: "game:start" | "round:next",
  command: EmptyCommand = {},
): Promise<CommandResult<LobbyView>> {
  return new Promise((resolve) => socket.emit(event, command, resolve));
}

function selectionCommand(
  socket: TestSocket,
  event: "selection:initial" | "selection:pause",
  command: SelectionCommand,
): Promise<CommandResult<LobbyView>> {
  return new Promise((resolve) => socket.emit(event, command, resolve));
}

function expectSuccess<T>(result: CommandResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected success, received ${result.error.code}`);
  }
  return result.data;
}

function expectFailure<T>(result: CommandResult<T>, code: string): void {
  expect(result).toMatchObject({ ok: false, error: { code } });
}

function nextState(
  socket: TestSocket,
  predicate: (state: LobbyView) => boolean,
): Promise<LobbyView> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("lobby:state", listener);
      reject(new Error("Timed out waiting for lobby state"));
    }, 2_000);
    const listener = (state: LobbyView) => {
      if (!predicate(state)) {
        return;
      }
      clearTimeout(timeout);
      socket.off("lobby:state", listener);
      resolve(state);
    };
    socket.on("lobby:state", listener);
  });
}

async function createPlayer(name: string): Promise<PlayerSession> {
  const socket = await connectClient();
  return { socket, ...expectSuccess(await createLobby(socket, name)) };
}

async function joinPlayer(
  joinCode: string,
  name: string,
): Promise<PlayerSession> {
  const socket = await connectClient();
  return { socket, ...expectSuccess(await joinLobby(socket, joinCode, name)) };
}

async function createThreePlayerLobby(): Promise<[
  PlayerSession,
  PlayerSession,
  PlayerSession,
]> {
  const host = await createPlayer("Host");
  const second = await joinPlayer(host.state.lobby.joinCode, "Second");
  const third = await joinPlayer(host.state.lobby.joinCode, "Third");
  return [host, second, third];
}

beforeEach(async () => {
  sockets = [];
  await startServer();
});

afterEach(async () => {
  for (const socket of sockets) {
    socket.disconnect();
  }
  await new Promise<void>((resolve) => server.io.close(() => resolve()));
});

describe("online lobby flow", () => {
  it("creates, joins, and starts a 3-player server-authoritative game", async () => {
    const [host, second, third] = await createThreePlayerLobby();

    expect(host.state.lobby.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(host.state.lobby.joinCode).toMatch(
      /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/,
    );
    expect(host.reconnectToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.state.self.playerId).not.toBe(host.state.self.playerId);
    expect(third.state.self.playerId).not.toBe(second.state.self.playerId);

    expectFailure(await emptyCommand(second.socket, "game:start"), "host-only");
    const started = expectSuccess(await emptyCommand(host.socket, "game:start"));

    expect(started.lobby.status).toBe("playing");
    expect(Object.keys(started.lobby.players)).toHaveLength(3);
    expect(started.lobby.game?.round.phase).toBe("initial-selection");
    expect(started.self.hand).toHaveLength(6);
    expect(started.lobby.game?.players[started.self.playerId]).toMatchObject({
      handSize: 6,
    });
    expect(started.lobby.game?.players[started.self.playerId]).not.toHaveProperty(
      "hand",
    );
  });

  it("enforces the 3-8 player lobby limits and closes joining after start", async () => {
    const host = await createPlayer("Host");
    const second = await joinPlayer(host.state.lobby.joinCode.toLowerCase(), "Second");

    expectFailure(await emptyCommand(host.socket, "game:start"), "not-enough-players");
    const players = [host, second];
    for (let index = 3; index <= 8; index += 1) {
      players.push(await joinPlayer(host.state.lobby.joinCode, `Player ${index}`));
    }
    const ninthSocket = await connectClient();
    expectFailure(
      await joinLobby(ninthSocket, host.state.lobby.joinCode, "Ninth"),
      "lobby-full",
    );

    expectSuccess(await emptyCommand(host.socket, "game:start"));
    const lateSocket = await connectClient();
    expectFailure(
      await joinLobby(lateSocket, host.state.lobby.joinCode, "Late"),
      "game-already-started",
    );
  });

  it("requires every lobby seat to be connected before starting", async () => {
    const [host, , third] = await createThreePlayerLobby();
    const thirdId = third.state.self.playerId;
    const disconnected = nextState(
      host.socket,
      (state) => state.lobby.players[thirdId]?.connected === false,
    );
    third.socket.disconnect();
    await disconnected;

    expectFailure(
      await emptyCommand(host.socket, "game:start"),
      "players-disconnected",
    );

    const replacement = await connectClient();
    expectSuccess(
      await reconnectLobby(replacement, {
        lobbyId: third.state.lobby.id,
        playerId: thirdId,
        reconnectToken: third.reconnectToken,
      }),
    );
    expectSuccess(await emptyCommand(host.socket, "game:start"));
  });

  it("rejects malformed transport payloads and tolerates missing acknowledgements", async () => {
    const socket = await connectClient();
    const rawSocket = socket as unknown as {
      emit(event: string, ...args: unknown[]): void;
    };
    const malformed = async <T>(
      event: string,
      input: unknown,
    ): Promise<CommandResult<T>> =>
      new Promise((resolve) => rawSocket.emit(event, input, resolve));

    expectFailure(await malformed("lobby:create", null), "invalid-input");
    expectFailure(await malformed("lobby:create", 1), "invalid-input");
    expectFailure(await malformed("lobby:join", null), "invalid-input");
    expectFailure(await malformed("lobby:join", "code"), "invalid-input");
    expectFailure(await malformed("lobby:reconnect", false), "invalid-input");
    expectFailure(await malformed("lobby:reconnect", {}), "invalid-input");
    expectFailure(await malformed("selection:pause", null), "invalid-input");
    expectFailure(await malformed("selection:pause", "card"), "invalid-input");
    expectFailure(await malformed("round:next", null), "invalid-input");
    expectFailure(await malformed("round:next", 1), "invalid-input");

    rawSocket.emit("lobby:create", { name: "Ignored" });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(socket.connected).toBe(true);
    expectSuccess(await createLobby(socket, "Host"));
  });

  it("rejects invalid input, unauthenticated commands, and unavailable cards", async () => {
    const anonymous = await connectClient();
    expectFailure(await emptyCommand(anonymous, "game:start"), "not-authenticated");

    const invalidCreate = await new Promise<CommandResult<SessionData>>((resolve) =>
      anonymous.emit(
        "lobby:create",
        { name: "Host", unexpected: true } as never,
        resolve,
      ),
    );
    expectFailure(invalidCreate, "invalid-input");
    expectFailure(
      await new Promise<CommandResult<LobbyView>>((resolve) =>
        anonymous.emit("game:start", { unexpected: true } as never, resolve),
      ),
      "invalid-input",
    );

    const [host, second] = await createThreePlayerLobby();
    expectFailure(
      await joinLobby(host.socket, host.state.lobby.joinCode, "Again"),
      "already-authenticated",
    );
    expectSuccess(await emptyCommand(host.socket, "game:start"));
    expectFailure(
      await new Promise<CommandResult<LobbyView>>((resolve) =>
        second.socket.emit(
          "selection:initial",
          { cardId: "card", playerId: second.state.self.playerId } as never,
          resolve,
        ),
      ),
      "invalid-input",
    );
    expectFailure(
      await selectionCommand(second.socket, "selection:initial", {
        cardId: playerCardId(host.state.self.playerId, host.state.self.playerId),
      }),
      "card-unavailable",
    );
    const ownCard = playerCardId(second.state.self.playerId, second.state.self.playerId);
    expectSuccess(
      await selectionCommand(second.socket, "selection:initial", { cardId: ownCard }),
    );
    expectFailure(
      await selectionCommand(second.socket, "selection:initial", { cardId: ownCard }),
      "choice-already-submitted",
    );
    expectFailure(await emptyCommand(second.socket, "round:next"), "wrong-phase");
  });
});

describe("secret game flow", () => {
  it("keeps initial choices private until everyone submits, resolves, and advances", async () => {
    const [host, second, third] = await createThreePlayerLobby();
    const started = expectSuccess(await emptyCommand(host.socket, "game:start"));
    const hostId = host.state.self.playerId;
    const secondId = second.state.self.playerId;
    const thirdId = third.state.self.playerId;
    const hostChoice = playerCardId(hostId, secondId);
    const secondChoice = playerCardId(secondId, hostId);
    const thirdChoice = playerCardId(thirdId, thirdId);

    expect(started.self.hand?.map(({ id }) => id)).toContain(hostChoice);
    const secondUpdate = nextState(
      second.socket,
      (state) =>
        state.lobby.game?.round.initialSelectionsSubmittedBy.includes(hostId) ?? false,
    );
    const hostAfterChoice = expectSuccess(
      await selectionCommand(host.socket, "selection:initial", {
        cardId: hostChoice,
      }),
    );
    const secondBeforeReveal = await secondUpdate;

    expect(hostAfterChoice.self.initialSelectionCardId).toBe(hostChoice);
    expect(hostAfterChoice.lobby.game?.round.revealedInitialSelections).toBeNull();
    expect(hostAfterChoice.lobby.game?.round).not.toHaveProperty("initialSelections");
    expect(JSON.stringify(secondBeforeReveal)).not.toContain(hostChoice);
    expect(
      secondBeforeReveal.self.hand?.every(({ ownerId }) => ownerId === secondId),
    ).toBe(true);

    expectSuccess(
      await selectionCommand(second.socket, "selection:initial", {
        cardId: secondChoice,
      }),
    );
    const resolved = expectSuccess(
      await selectionCommand(third.socket, "selection:initial", {
        cardId: thirdChoice,
      }),
    );
    expect(resolved.lobby.game?.round.phase).toBe("resolved");
    expect(resolved.lobby.game?.round.revealedInitialSelections?.[hostId]?.id).toBe(
      hostChoice,
    );
    expect(resolved.lobby.game?.round.resolution?.connections).toContainEqual({
      kind: "player",
      playerIds: [hostId, secondId],
      step: "initial",
    });

    const next = expectSuccess(await emptyCommand(second.socket, "round:next"));
    expect(next.lobby.game?.round).toMatchObject({
      number: 2,
      phase: "initial-selection",
      initialSelectionsSubmittedBy: [],
    });
  });

  it("reveals initial pause cards while hiding follow-ups until resolution", async () => {
    const [host, second, third] = await createThreePlayerLobby();
    expectSuccess(await emptyCommand(host.socket, "game:start"));
    const hostId = host.state.self.playerId;
    const secondId = second.state.self.playerId;
    const thirdId = third.state.self.playerId;

    expectSuccess(
      await selectionCommand(host.socket, "selection:initial", {
        cardId: pauseCardId(hostId),
      }),
    );
    expectSuccess(
      await selectionCommand(second.socket, "selection:initial", {
        cardId: pauseCardId(secondId),
      }),
    );
    const pausePhase = expectSuccess(
      await selectionCommand(third.socket, "selection:initial", {
        cardId: playerCardId(thirdId, thirdId),
      }),
    );
    expect(pausePhase.lobby.game?.round.phase).toBe("pause-selection");
    expect(pausePhase.lobby.game?.round.revealedInitialSelections?.[hostId]?.kind)
      .toBe("pause");

    const hostFollowup = playerCardId(hostId, secondId);
    const secondUpdate = nextState(
      second.socket,
      (state) =>
        state.lobby.game?.round.pauseSelectionsSubmittedBy.includes(hostId) ?? false,
    );
    expectSuccess(
      await selectionCommand(host.socket, "selection:pause", {
        cardId: hostFollowup,
      }),
    );
    expect(JSON.stringify(await secondUpdate)).not.toContain(hostFollowup);

    const resolved = expectSuccess(
      await selectionCommand(second.socket, "selection:pause", {
        cardId: playerCardId(secondId, hostId),
      }),
    );
    expect(resolved.lobby.game?.round.phase).toBe("resolved");
    expect(resolved.lobby.game?.round.revealedPauseSelections?.[hostId]?.id).toBe(
      hostFollowup,
    );
  });
});

describe("connection recovery", () => {
  it("broadcasts disconnects, authenticates reconnection, and rotates tokens", async () => {
    const [host, second] = await createThreePlayerLobby();
    const secondId = second.state.self.playerId;
    expectSuccess(await emptyCommand(host.socket, "game:start"));
    const selectedCardId = playerCardId(secondId, secondId);
    const submitted = expectSuccess(
      await selectionCommand(second.socket, "selection:initial", {
        cardId: selectedCardId,
      }),
    );
    const disconnectedState = nextState(
      host.socket,
      (state) => state.lobby.players[secondId]?.connected === false,
    );
    second.socket.disconnect();
    const disconnected = await disconnectedState;
    expect(disconnected.lobby.players[secondId]?.connected).toBe(false);
    expect(disconnected.lobby.game?.players[secondId]?.connected).toBe(false);

    const invalidSocket = await connectClient();
    const invalidToken = `${second.reconnectToken.slice(0, -1)}${
      second.reconnectToken.endsWith("A") ? "B" : "A"
    }`;
    expectFailure(
      await reconnectLobby(invalidSocket, {
        lobbyId: second.state.lobby.id,
        playerId: secondId,
        reconnectToken: invalidToken,
      }),
      "invalid-credentials",
    );

    const reconnectedState = nextState(
      host.socket,
      (state) => state.lobby.players[secondId]?.connected === true,
    );
    const replacement = await connectClient();
    const recovered = expectSuccess(
      await reconnectLobby(replacement, {
        lobbyId: second.state.lobby.id,
        playerId: secondId,
        reconnectToken: second.reconnectToken,
      }),
    );
    expect(recovered.reconnectToken).not.toBe(second.reconnectToken);
    expect(recovered.state.self.playerId).toBe(secondId);
    expect(recovered.state.self.hand).toEqual(submitted.self.hand);
    expect(recovered.state.self.initialSelectionCardId).toBe(selectedCardId);
    expect((await reconnectedState).lobby.players[secondId]?.connected).toBe(true);

    const replaySocket = await connectClient();
    expectFailure(
      await reconnectLobby(replaySocket, {
        lobbyId: second.state.lobby.id,
        playerId: secondId,
        reconnectToken: second.reconnectToken,
      }),
      "invalid-credentials",
    );

    const redisconnectedState = nextState(
      host.socket,
      (state) => state.lobby.players[secondId]?.connected === false,
    );
    replacement.disconnect();
    await redisconnectedState;

    const retrySocket = await connectClient();
    const retry = expectSuccess(
      await reconnectLobby(retrySocket, {
        lobbyId: second.state.lobby.id,
        playerId: secondId,
        reconnectToken: second.reconnectToken,
      }),
    );
    expect(retry.reconnectToken).toBe(recovered.reconnectToken);

    const secondReplaySocket = await connectClient();
    expectFailure(
      await reconnectLobby(secondReplaySocket, {
        lobbyId: second.state.lobby.id,
        playerId: secondId,
        reconnectToken: second.reconnectToken,
      }),
      "invalid-credentials",
    );
  });

  it("recovers a rotated token when the first reconnect acknowledgement is ignored", async () => {
    const host = await createPlayer("Host");
    const replacement = await connectClient();
    const replaced = new Promise<void>((resolve) =>
      host.socket.once("session:replaced", resolve),
    );

    replacement.emit(
      "lobby:reconnect",
      {
        lobbyId: host.state.lobby.id,
        playerId: host.state.self.playerId,
        reconnectToken: host.reconnectToken,
      },
      () => undefined,
    );
    await replaced;

    const retry = expectSuccess(
      await reconnectLobby(replacement, {
        lobbyId: host.state.lobby.id,
        playerId: host.state.self.playerId,
        reconnectToken: host.reconnectToken,
      }),
    );
    expect(retry.reconnectToken).not.toBe(host.reconnectToken);

    const replay = await connectClient();
    expectFailure(
      await reconnectLobby(replay, {
        lobbyId: host.state.lobby.id,
        playerId: host.state.self.playerId,
        reconnectToken: host.reconnectToken,
      }),
      "invalid-credentials",
    );
  });

  it("does not let another authenticated session consume reconnect grace", async () => {
    const [host, second] = await createThreePlayerLobby();
    const credentials = {
      lobbyId: second.state.lobby.id,
      playerId: second.state.self.playerId,
      reconnectToken: second.reconnectToken,
    };
    const replacement = await connectClient();
    const recovered = expectSuccess(
      await reconnectLobby(replacement, credentials),
    );

    expectFailure(
      await reconnectLobby(host.socket, credentials),
      "already-authenticated",
    );

    const retry = expectSuccess(await reconnectLobby(replacement, credentials));
    expect(retry.reconnectToken).toBe(recovered.reconnectToken);
  });

  it("replaces an active socket without broadcasting a false disconnect", async () => {
    const [host, second] = await createThreePlayerLobby();
    const secondId = second.state.self.playerId;
    const connectionUpdates: boolean[] = [];
    host.socket.on("lobby:state", (state) => {
      const connected = state.lobby.players[secondId]?.connected;
      if (connected !== undefined) {
        connectionUpdates.push(connected);
      }
    });
    const replaced = new Promise<void>((resolve) =>
      second.socket.once("session:replaced", resolve),
    );
    const replacement = await connectClient();
    expectSuccess(
      await reconnectLobby(replacement, {
        lobbyId: second.state.lobby.id,
        playerId: secondId,
        reconnectToken: second.reconnectToken,
      }),
    );
    await replaced;
    expect(second.socket.connected).toBe(false);
    expect(connectionUpdates).not.toContain(false);

    const disconnectedState = nextState(
      host.socket,
      (state) => state.lobby.players[secondId]?.connected === false,
    );
    replacement.disconnect();
    const latestHostState = await disconnectedState;
    expect(latestHostState.lobby.players[secondId]?.connected).toBe(false);
  });

  it("expires abandoned lobbies and removes their join-code index", async () => {
    await restartServer({ abandonedLobbyTtlMs: 25 });
    const host = await createPlayer("Host");
    const credentials = {
      lobbyId: host.state.lobby.id,
      playerId: host.state.self.playerId,
      reconnectToken: host.reconnectToken,
    };
    const joinCode = host.state.lobby.joinCode;
    host.socket.disconnect();
    await new Promise<void>((resolve) => setTimeout(resolve, 60));

    const joinSocket = await connectClient();
    expectFailure(await joinLobby(joinSocket, joinCode, "Late"), "lobby-not-found");
    const reconnectSocket = await connectClient();
    expectFailure(
      await reconnectLobby(reconnectSocket, credentials),
      "invalid-credentials",
    );
  });

  it("caps concurrent connections per IP and releases capacity on disconnect", async () => {
    await restartServer({ maxConnectionsPerIp: 2 });
    const first = await connectClient();
    await connectClient();

    await expect(connectClient()).rejects.toThrow(
      "Too many connections from this address",
    );

    first.disconnect();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await expect(connectClient()).resolves.toBeDefined();
  });

  it("rate-limits lobby creation per IP with a deterministic window", async () => {
    let currentTime = 1_000;
    await restartServer({
      maxLobbyCreatesPerIp: 2,
      lobbyCreateWindowMs: 100,
      now: () => currentTime,
    });
    await createPlayer("First");
    await createPlayer("Second");
    const limited = await connectClient();

    expectFailure(await createLobby(limited, "Limited"), "rate-limited");

    currentTime += 101;
    expectSuccess(await createLobby(limited, "Allowed"));
  });

  it("expires connected waiting lobbies and releases global lobby capacity", async () => {
    await restartServer({ maxActiveLobbies: 1, waitingLobbyTtlMs: 25 });
    const host = await createPlayer("Host");
    const credentials = {
      lobbyId: host.state.lobby.id,
      playerId: host.state.self.playerId,
      reconnectToken: host.reconnectToken,
    };
    const joinCode = host.state.lobby.joinCode;
    const blocked = await connectClient();

    expectFailure(await createLobby(blocked, "Blocked"), "server-capacity");
    await new Promise<void>((resolve) =>
      host.socket.once("disconnect", () => resolve()),
    );

    expectSuccess(await createLobby(blocked, "Replacement"));
    const joinSocket = await connectClient();
    expectFailure(await joinLobby(joinSocket, joinCode, "Late"), "lobby-not-found");
    const reconnectSocket = await connectClient();
    expectFailure(
      await reconnectLobby(reconnectSocket, credentials),
      "invalid-credentials",
    );
  });
});
