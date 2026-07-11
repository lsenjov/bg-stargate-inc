import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";

import {
  GameRuleError,
  createGame,
  createLobbySchema,
  emptyCommandSchema,
  joinLobbySchema,
  reconnectLobbySchema,
  selectionCommandSchema,
  startNextRound,
  submitInitialSelection,
  submitPauseSelection,
  toPublicGameState,
  type ClientToServerEvents,
  type CommandCallback,
  type CommandErrorCode,
  type GameSetup,
  type InterServerEvents,
  type LobbyState,
  type LobbyView,
  type PlayerId,
  type PublicLobbyPlayer,
  type PublicLobbyState,
  type ServerToClientEvents,
  type SocketData,
} from "@stargate-inc/shared";
import { Server, type Socket } from "socket.io";

type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

type GameIo = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

interface Session {
  lobbyId: string;
  playerId: PlayerId;
}

interface ReconnectTokenGrace {
  previousToken: string;
  currentToken: string;
  expiresAt: number;
}

export interface GameServerOptions {
  corsOrigin?: string | string[];
  reconnectTokenGraceMs?: number;
  abandonedLobbyTtlMs?: number;
}

export interface GameServer {
  httpServer: HttpServer;
  io: GameIo;
}

class CommandFailure extends Error {
  constructor(
    readonly code: CommandErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const exoplanets: GameSetup["exoplanets"] = [
  { id: "alpha", name: "Exoplanet Alpha" },
  { id: "beta", name: "Exoplanet Beta" },
];

const joinCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomId(): string {
  return randomBytes(16).toString("base64url");
}

function randomReconnectToken(): string {
  return randomBytes(32).toString("base64url");
}

function randomJoinCode(): string {
  return Array.from(
    { length: 10 },
    () => joinCodeAlphabet[randomInt(joinCodeAlphabet.length)],
  ).join("");
}

function createRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function setRecordValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer);
}

function publicLobby(lobby: LobbyState): PublicLobbyState {
  const players = createRecord<PublicLobbyPlayer>();
  for (const playerId of Object.keys(lobby.players)) {
    const player = lobby.players[playerId]!;
    setRecordValue(players, playerId, {
      id: player.id,
      name: player.name,
      connected: player.connected,
    });
  }
  return {
    id: lobby.id,
    joinCode: lobby.joinCode,
    hostPlayerId: lobby.hostPlayerId,
    status: lobby.status,
    players,
    game: lobby.game ? toPublicGameState(lobby.game) : null,
  };
}

function lobbyView(lobby: LobbyState, playerId: PlayerId): LobbyView {
  const gamePlayer = lobby.game?.players[playerId];
  return {
    lobby: publicLobby(lobby),
    self: {
      playerId,
      hand: gamePlayer ? structuredClone(gamePlayer.hand) : null,
      initialSelectionCardId:
        lobby.game?.round.initialSelections[playerId]?.id ?? null,
      pauseSelectionCardId:
        lobby.game?.round.pauseSelections[playerId]?.id ?? null,
    },
  };
}

function failureResult<T>(
  callback: CommandCallback<T>,
  code: CommandErrorCode,
  message: string,
): void {
  callback({ ok: false, error: { code, message } });
}

function runCommand<T>(
  callback: CommandCallback<T>,
  command: () => T,
): void {
  if (typeof callback !== "function") {
    return;
  }
  try {
    callback({ ok: true, data: command() });
  } catch (error) {
    if (error instanceof CommandFailure || error instanceof GameRuleError) {
      failureResult(callback, error.code, error.message);
      return;
    }
    failureResult(callback, "internal-error", "The server could not process the command");
  }
}

export function createGameServer(options: GameServerOptions = {}): GameServer {
  const httpServer = createServer((_, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
  });
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: { origin: options.corsOrigin ?? "http://localhost:5173" },
  });
  const lobbies = new Map<string, LobbyState>();
  const lobbyIdsByJoinCode = new Map<string, string>();
  const sessionsBySocketId = new Map<string, Session>();
  const socketIdsByPlayer = new Map<string, string>();
  const reconnectTokenGrace = new Map<string, ReconnectTokenGrace>();
  const reconnectTokenGraceTimers = new Map<string, NodeJS.Timeout>();
  const abandonedLobbyTimers = new Map<string, NodeJS.Timeout>();
  const reconnectTokenGraceMs = options.reconnectTokenGraceMs ?? 5_000;
  const abandonedLobbyTtlMs = options.abandonedLobbyTtlMs ?? 30 * 60_000;

  const playerKey = (session: Session) =>
    `${session.lobbyId}\u0000${session.playerId}`;

  const clearReconnectTokenGrace = (key: string): void => {
    reconnectTokenGrace.delete(key);
    const timer = reconnectTokenGraceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      reconnectTokenGraceTimers.delete(key);
    }
  };

  const retainReconnectTokenGrace = (
    key: string,
    previousToken: string,
    currentToken: string,
  ): void => {
    clearReconnectTokenGrace(key);
    const grace = {
      previousToken,
      currentToken,
      expiresAt: Date.now() + reconnectTokenGraceMs,
    };
    reconnectTokenGrace.set(key, grace);
    const timer = setTimeout(() => {
      if (reconnectTokenGrace.get(key) === grace) {
        reconnectTokenGrace.delete(key);
      }
      reconnectTokenGraceTimers.delete(key);
    }, reconnectTokenGraceMs);
    timer.unref();
    reconnectTokenGraceTimers.set(key, timer);
  };

  const consumeReconnectTokenGrace = (
    key: string,
    reconnectToken: string,
  ): string | undefined => {
    const grace = reconnectTokenGrace.get(key);
    if (!grace) {
      return undefined;
    }
    if (grace.expiresAt <= Date.now()) {
      clearReconnectTokenGrace(key);
      return undefined;
    }
    if (!secureEqual(grace.previousToken, reconnectToken)) {
      return undefined;
    }
    const currentToken = grace.currentToken;
    clearReconnectTokenGrace(key);
    return currentToken;
  };

  const cancelAbandonedLobbyCleanup = (lobbyId: string): void => {
    const timer = abandonedLobbyTimers.get(lobbyId);
    if (timer) {
      clearTimeout(timer);
      abandonedLobbyTimers.delete(lobbyId);
    }
  };

  const deleteLobby = (lobby: LobbyState): void => {
    if (lobbies.get(lobby.id) !== lobby) {
      return;
    }
    lobbies.delete(lobby.id);
    lobbyIdsByJoinCode.delete(lobby.joinCode);
    cancelAbandonedLobbyCleanup(lobby.id);
    for (const playerId of Object.keys(lobby.players)) {
      clearReconnectTokenGrace(playerKey({ lobbyId: lobby.id, playerId }));
    }
  };

  const scheduleAbandonedLobbyCleanup = (lobby: LobbyState): void => {
    if (
      abandonedLobbyTimers.has(lobby.id) ||
      Object.values(lobby.players).some(({ connected }) => connected)
    ) {
      return;
    }
    const timer = setTimeout(() => {
      abandonedLobbyTimers.delete(lobby.id);
      if (
        lobbies.get(lobby.id) === lobby &&
        Object.values(lobby.players).every(({ connected }) => !connected)
      ) {
        deleteLobby(lobby);
      }
    }, abandonedLobbyTtlMs);
    timer.unref();
    abandonedLobbyTimers.set(lobby.id, timer);
  };

  const getLobby = (lobbyId: string): LobbyState => {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) {
      throw new CommandFailure("lobby-not-found", "Lobby not found");
    }
    return lobby;
  };

  const requireSession = (socket: GameSocket): Session => {
    const session = sessionsBySocketId.get(socket.id);
    if (!session) {
      throw new CommandFailure(
        "not-authenticated",
        "Create, join, or reconnect to a lobby first",
      );
    }
    return session;
  };

  const requireUnauthenticated = (socket: GameSocket): void => {
    if (sessionsBySocketId.has(socket.id)) {
      throw new CommandFailure(
        "already-authenticated",
        "This connection already belongs to a player",
      );
    }
  };

  const setConnected = (
    lobby: LobbyState,
    playerId: PlayerId,
    connected: boolean,
  ): void => {
    lobby.players[playerId]!.connected = connected;
    if (lobby.game) {
      lobby.game.players[playerId]!.connected = connected;
    }
  };

  const emitLobby = (lobby: LobbyState): void => {
    for (const playerId of Object.keys(lobby.players)) {
      const socketId = socketIdsByPlayer.get(
        playerKey({ lobbyId: lobby.id, playerId }),
      );
      const recipient = socketId ? io.sockets.sockets.get(socketId) : undefined;
      recipient?.emit("lobby:state", lobbyView(lobby, playerId));
    }
  };

  const attachSession = (
    socket: GameSocket,
    lobby: LobbyState,
    playerId: PlayerId,
  ): void => {
    cancelAbandonedLobbyCleanup(lobby.id);
    const session = { lobbyId: lobby.id, playerId };
    sessionsBySocketId.set(socket.id, session);
    socketIdsByPlayer.set(playerKey(session), socket.id);
    setConnected(lobby, playerId, true);
  };

  io.on("connection", (socket) => {
    socket.on("lobby:create", (input, callback) => {
      runCommand(callback, () => {
        requireUnauthenticated(socket);
        const parsed = createLobbySchema.safeParse(input);
        if (!parsed.success) {
          throw new CommandFailure("invalid-input", "Invalid lobby creation payload");
        }

        let joinCode = randomJoinCode();
        while (lobbyIdsByJoinCode.has(joinCode)) {
          joinCode = randomJoinCode();
        }
        const lobbyId = randomId();
        const playerId = randomId();
        const reconnectToken = randomReconnectToken();
        const players = createRecord<LobbyState["players"][PlayerId]>();
        setRecordValue(players, playerId, {
          id: playerId,
          name: parsed.data.name,
          connected: true,
          reconnectToken,
        });
        const lobby: LobbyState = {
          id: lobbyId,
          joinCode,
          hostPlayerId: playerId,
          status: "waiting",
          players,
          game: null,
        };
        lobbies.set(lobbyId, lobby);
        lobbyIdsByJoinCode.set(joinCode, lobbyId);
        attachSession(socket, lobby, playerId);
        emitLobby(lobby);
        return { state: lobbyView(lobby, playerId), reconnectToken };
      });
    });

    socket.on("lobby:join", (input, callback) => {
      runCommand(callback, () => {
        requireUnauthenticated(socket);
        const parsed = joinLobbySchema.safeParse(input);
        if (!parsed.success) {
          throw new CommandFailure("invalid-input", "Invalid lobby join payload");
        }
        const lobbyId = lobbyIdsByJoinCode.get(parsed.data.joinCode);
        if (!lobbyId) {
          throw new CommandFailure("lobby-not-found", "Lobby not found");
        }
        const lobby = getLobby(lobbyId);
        if (lobby.status !== "waiting") {
          throw new CommandFailure(
            "game-already-started",
            "This lobby's game has already started",
          );
        }
        if (Object.keys(lobby.players).length >= 8) {
          throw new CommandFailure("lobby-full", "This lobby already has 8 players");
        }

        const playerId = randomId();
        const reconnectToken = randomReconnectToken();
        setRecordValue(lobby.players, playerId, {
          id: playerId,
          name: parsed.data.name,
          connected: true,
          reconnectToken,
        });
        attachSession(socket, lobby, playerId);
        emitLobby(lobby);
        return { state: lobbyView(lobby, playerId), reconnectToken };
      });
    });

    socket.on("lobby:reconnect", (input, callback) => {
      runCommand(callback, () => {
        const parsed = reconnectLobbySchema.safeParse(input);
        if (!parsed.success) {
          throw new CommandFailure("invalid-input", "Invalid reconnect payload");
        }
        const lobby = lobbies.get(parsed.data.lobbyId);
        const player = lobby?.players[parsed.data.playerId];
        if (!lobby || !player) {
          throw new CommandFailure(
            "invalid-credentials",
            "Reconnect credentials are invalid",
          );
        }

        const session = {
          lobbyId: lobby.id,
          playerId: player.id,
        };
        const key = playerKey(session);
        const existingSession = sessionsBySocketId.get(socket.id);
        if (
          existingSession &&
          (existingSession.lobbyId !== session.lobbyId ||
            existingSession.playerId !== session.playerId)
        ) {
          throw new CommandFailure(
            "already-authenticated",
            "This connection already belongs to a player",
          );
        }
        const retriedToken = consumeReconnectTokenGrace(
          key,
          parsed.data.reconnectToken,
        );
        if (existingSession) {
          if (!retriedToken) {
            throw new CommandFailure(
              "already-authenticated",
              "This connection already belongs to a player",
            );
          }
          return {
            state: lobbyView(lobby, player.id),
            reconnectToken: retriedToken,
          };
        }
        const usesCurrentToken = secureEqual(
          player.reconnectToken,
          parsed.data.reconnectToken,
        );
        if (!usesCurrentToken && !retriedToken) {
          throw new CommandFailure(
            "invalid-credentials",
            "Reconnect credentials are invalid",
          );
        }

        const oldSocketId = socketIdsByPlayer.get(playerKey(session));
        const oldSocket = oldSocketId ? io.sockets.sockets.get(oldSocketId) : undefined;
        if (usesCurrentToken) {
          const previousToken = player.reconnectToken;
          player.reconnectToken = randomReconnectToken();
          retainReconnectTokenGrace(key, previousToken, player.reconnectToken);
          if (lobby.game) {
            lobby.game.players[player.id]!.reconnectToken = player.reconnectToken;
          }
        }
        attachSession(socket, lobby, player.id);
        if (oldSocket && oldSocket.id !== socket.id) {
          oldSocket.emit("session:replaced");
          oldSocket.disconnect(true);
        }
        emitLobby(lobby);
        return {
          state: lobbyView(lobby, player.id),
          reconnectToken: player.reconnectToken,
        };
      });
    });

    socket.on("game:start", (input, callback) => {
      runCommand(callback, () => {
        const parsed = emptyCommandSchema.safeParse(input);
        if (!parsed.success) {
          throw new CommandFailure("invalid-input", "Invalid start payload");
        }
        const session = requireSession(socket);
        const lobby = getLobby(session.lobbyId);
        if (lobby.hostPlayerId !== session.playerId) {
          throw new CommandFailure("host-only", "Only the host can start the game");
        }
        if (lobby.game) {
          throw new CommandFailure("game-already-started", "The game has already started");
        }
        const players = Object.values(lobby.players);
        if (players.length < 3) {
          throw new CommandFailure(
            "not-enough-players",
            "A game requires at least 3 players",
          );
        }
        if (players.some(({ connected }) => !connected)) {
          throw new CommandFailure(
            "players-disconnected",
            "All players must be connected before the game can start",
          );
        }
        lobby.game = createGame({
          id: randomId(),
          players: players.map(({ id, name, reconnectToken }) => ({
            id,
            name,
            reconnectToken,
          })),
          exoplanets,
        });
        for (const player of players) {
          lobby.game.players[player.id]!.connected = player.connected;
        }
        lobby.status = "playing";
        emitLobby(lobby);
        return lobbyView(lobby, session.playerId);
      });
    });

    socket.on("selection:initial", (input, callback) => {
      runCommand(callback, () => {
        const parsed = selectionCommandSchema.safeParse(input);
        if (!parsed.success) {
          throw new CommandFailure("invalid-input", "Invalid initial selection payload");
        }
        const session = requireSession(socket);
        const lobby = getLobby(session.lobbyId);
        if (!lobby.game) {
          throw new CommandFailure("game-not-started", "The game has not started");
        }
        lobby.game = submitInitialSelection(
          lobby.game,
          session.playerId,
          parsed.data.cardId,
        );
        emitLobby(lobby);
        return lobbyView(lobby, session.playerId);
      });
    });

    socket.on("selection:pause", (input, callback) => {
      runCommand(callback, () => {
        const parsed = selectionCommandSchema.safeParse(input);
        if (!parsed.success) {
          throw new CommandFailure("invalid-input", "Invalid pause selection payload");
        }
        const session = requireSession(socket);
        const lobby = getLobby(session.lobbyId);
        if (!lobby.game) {
          throw new CommandFailure("game-not-started", "The game has not started");
        }
        lobby.game = submitPauseSelection(
          lobby.game,
          session.playerId,
          parsed.data.cardId,
        );
        emitLobby(lobby);
        return lobbyView(lobby, session.playerId);
      });
    });

    socket.on("round:next", (input, callback) => {
      runCommand(callback, () => {
        const parsed = emptyCommandSchema.safeParse(input);
        if (!parsed.success) {
          throw new CommandFailure("invalid-input", "Invalid next-round payload");
        }
        const session = requireSession(socket);
        const lobby = getLobby(session.lobbyId);
        if (!lobby.game) {
          throw new CommandFailure("game-not-started", "The game has not started");
        }
        lobby.game = startNextRound(lobby.game);
        emitLobby(lobby);
        return lobbyView(lobby, session.playerId);
      });
    });

    socket.on("disconnect", () => {
      const session = sessionsBySocketId.get(socket.id);
      sessionsBySocketId.delete(socket.id);
      if (!session || socketIdsByPlayer.get(playerKey(session)) !== socket.id) {
        return;
      }
      socketIdsByPlayer.delete(playerKey(session));
      const lobby = lobbies.get(session.lobbyId);
      if (!lobby) {
        return;
      }
      setConnected(lobby, session.playerId, false);
      emitLobby(lobby);
      scheduleAbandonedLobbyCleanup(lobby);
    });
  });

  return { httpServer, io };
}
