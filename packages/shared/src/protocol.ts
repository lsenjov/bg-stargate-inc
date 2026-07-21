import { z } from "zod";

import type {
  CardId,
  ExoplanetId,
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

export const selectionUndoCommandSchema = z.strictObject({});

const factoryIdSchema = z.string().min(1).max(256);
const moduleIdSchema = z.string().min(1).max(256);

const factoryConstructionTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new-factory") }),
  z.strictObject({
    kind: z.literal("factory"),
    factoryId: factoryIdSchema,
  }),
  z.strictObject({
    kind: z.literal("exoplanet-slot"),
    slotIndex: z.number().int().min(0).max(2),
  }),
]);

export const factoryConstructionCommandSchema = z.strictObject({
  moduleId: moduleIdSchema,
  target: factoryConstructionTargetSchema,
});

export const factoryRunCommandSchema = z.strictObject({
  factoryId: factoryIdSchema,
});

export const playerGestureKinds = [
  "beckon",
  "nod",
  "shake",
  "shrug",
  "wave",
  "applaud",
] as const;

export const exoplanetGestureKinds = [
  "point",
  "nod",
  "shake",
  "shrug",
] as const;

const playerGestureTargetSchema = z.strictObject({
  kind: z.literal("player"),
  playerId: opaqueIdSchema,
});

const exoplanetGestureTargetSchema = z.strictObject({
  kind: z.literal("exoplanet"),
  exoplanetId: z.string().min(1).max(256),
});

export const gestureCommandSchema = z.union([
  z.strictObject({
    target: playerGestureTargetSchema,
    gesture: z.enum(playerGestureKinds),
  }),
  z.strictObject({
    target: exoplanetGestureTargetSchema,
    gesture: z.enum(exoplanetGestureKinds),
  }),
]);

export type CreateLobbyCommand = z.input<typeof createLobbySchema>;
export type JoinLobbyCommand = z.input<typeof joinLobbySchema>;
export type ReconnectLobbyCommand = z.input<typeof reconnectLobbySchema>;
export type EmptyCommand = z.input<typeof emptyCommandSchema>;
export type SelectionCommand = z.input<typeof selectionCommandSchema>;
export type SelectionUndoCommand = z.input<typeof selectionUndoCommandSchema>;
export type FactoryConstructionCommand = z.input<
  typeof factoryConstructionCommandSchema
>;
export type FactoryRunCommand = z.input<typeof factoryRunCommandSchema>;
export type PlayerGestureKind = (typeof playerGestureKinds)[number];
export type ExoplanetGestureKind = (typeof exoplanetGestureKinds)[number];
export type PlayerGestureTarget = {
  kind: "player";
  playerId: PlayerId;
};
export type ExoplanetGestureTarget = {
  kind: "exoplanet";
  exoplanetId: ExoplanetId;
};
export type GestureTarget = PlayerGestureTarget | ExoplanetGestureTarget;
export type GestureCommand = z.input<typeof gestureCommandSchema>;

interface GestureEventBase {
  id: string;
  senderPlayerId: PlayerId;
  sentAt: number;
}

export type GestureEvent = GestureEventBase &
  (
    | { target: PlayerGestureTarget; gesture: PlayerGestureKind }
    | { target: ExoplanetGestureTarget; gesture: ExoplanetGestureKind }
  );

export type CommandErrorCode =
  | "invalid-input"
  | "already-authenticated"
  | "not-authenticated"
  | "lobby-not-found"
  | "lobby-full"
  | "rate-limited"
  | "server-capacity"
  | "game-already-started"
  | "invalid-credentials"
  | "host-only"
  | "not-enough-players"
  | "players-disconnected"
  | "game-not-started"
  | "internal-error"
  | "invalid-setup"
  | "unknown-player"
  | "unknown-exoplanet"
  | "gesture-target-unavailable"
  | "wrong-phase"
  | "choice-already-submitted"
  | "selection-not-submitted"
  | "card-unavailable"
  | "player-did-not-pause"
  | "pause-follow-up-must-target"
  | "connection-reward-unavailable"
  | "module-unavailable"
  | "insufficient-resources"
  | "factory-not-found"
  | "factory-type-mismatch"
  | "factory-slot-unavailable"
  | "factory-already-operated"
  | "factory-run-unavailable";

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
  selectionDeadlineAt: number | null;
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
  "selection:undo": (
    command: SelectionUndoCommand,
    callback: CommandCallback<LobbyView>,
  ) => void;
  "factory:construct": (
    command: FactoryConstructionCommand,
    callback: CommandCallback<LobbyView>,
  ) => void;
  "production:begin": (
    command: EmptyCommand,
    callback: CommandCallback<LobbyView>,
  ) => void;
  "production:run": (
    command: FactoryRunCommand,
    callback: CommandCallback<LobbyView>,
  ) => void;
  "production:stop-factory": (
    command: EmptyCommand,
    callback: CommandCallback<LobbyView>,
  ) => void;
  "connection:finish": (
    command: EmptyCommand,
    callback: CommandCallback<LobbyView>,
  ) => void;
  "round:next": (
    command: EmptyCommand,
    callback: CommandCallback<LobbyView>,
  ) => void;
  "gesture:send": (
    command: GestureCommand,
    callback: CommandCallback<GestureEvent>,
  ) => void;
}

export interface ServerToClientEvents {
  "lobby:state": (state: LobbyView) => void;
  "session:replaced": () => void;
  "gesture:received": (event: GestureEvent) => void;
}

export type InterServerEvents = Record<never, never>;

export type SocketData = Record<string, never>;
