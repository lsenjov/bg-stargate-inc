import { z } from "zod";

import type {
  CardId,
  LobbyId,
  LobbyPlayer,
  PlayerId,
  PublicGameState,
  ReconnectToken,
  SelectionCard,
} from "./model.js";

const opaqueIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const reconnectTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const joinCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
const playerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .refine((name) => !/[\p{Cc}\p{Cf}]/u.test(name));

export const createLobbySchema = z.strictObject({
  name: playerNameSchema,
});

export const joinLobbySchema = z.strictObject({
  joinCode: joinCodeSchema,
  name: playerNameSchema,
});

export const reconnectLobbySchema = z.strictObject({
  lobbyId: opaqueIdSchema,
  playerId: opaqueIdSchema,
  reconnectToken: reconnectTokenSchema,
});

export const emptyCommandSchema = z.strictObject({});

export const selectionCommandSchema = z.strictObject({
  cardId: z.string().min(1).max(256),
});

export type CreateLobbyCommand = z.input<typeof createLobbySchema>;
export type JoinLobbyCommand = z.input<typeof joinLobbySchema>;
export type ReconnectLobbyCommand = z.input<typeof reconnectLobbySchema>;
export type EmptyCommand = z.input<typeof emptyCommandSchema>;
export type SelectionCommand = z.input<typeof selectionCommandSchema>;

export type CommandErrorCode =
  | "invalid-input"
  | "already-authenticated"
  | "not-authenticated"
  | "lobby-not-found"
  | "lobby-full"
  | "game-already-started"
  | "invalid-credentials"
  | "host-only"
  | "not-enough-players"
  | "players-disconnected"
  | "game-not-started"
  | "internal-error"
  | "invalid-setup"
  | "unknown-player"
  | "wrong-phase"
  | "choice-already-submitted"
  | "card-unavailable"
  | "player-did-not-pause"
  | "pause-follow-up-must-target";

export interface CommandError {
  code: CommandErrorCode;
  message: string;
}

export type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: CommandError };

export type PublicLobbyPlayer = Omit<LobbyPlayer, "reconnectToken">;

export interface PublicLobbyState {
  id: LobbyId;
  joinCode: string;
  hostPlayerId: PlayerId;
  status: "waiting" | "playing";
  players: Record<PlayerId, PublicLobbyPlayer>;
  game: PublicGameState | null;
}

export interface PrivatePlayerState {
  playerId: PlayerId;
  hand: SelectionCard[] | null;
  initialSelectionCardId: CardId | null;
  pauseSelectionCardId: CardId | null;
}

export interface LobbyView {
  lobby: PublicLobbyState;
  self: PrivatePlayerState;
}

export interface SessionData {
  state: LobbyView;
  reconnectToken: ReconnectToken;
}

export type CommandCallback<T> = (result: CommandResult<T>) => void;

export interface ClientToServerEvents {
  "lobby:create": (
    command: CreateLobbyCommand,
    callback: CommandCallback<SessionData>,
  ) => void;
  "lobby:join": (
    command: JoinLobbyCommand,
    callback: CommandCallback<SessionData>,
  ) => void;
  "lobby:reconnect": (
    command: ReconnectLobbyCommand,
    callback: CommandCallback<SessionData>,
  ) => void;
  "game:start": (
    command: EmptyCommand,
    callback: CommandCallback<LobbyView>,
  ) => void;
  "selection:initial": (
    command: SelectionCommand,
    callback: CommandCallback<LobbyView>,
  ) => void;
  "selection:pause": (
    command: SelectionCommand,
    callback: CommandCallback<LobbyView>,
  ) => void;
  "round:next": (
    command: EmptyCommand,
    callback: CommandCallback<LobbyView>,
  ) => void;
}

export interface ServerToClientEvents {
  "lobby:state": (state: LobbyView) => void;
  "session:replaced": () => void;
}

export type InterServerEvents = Record<never, never>;

export type SocketData = Record<string, never>;
