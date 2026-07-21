export type LobbyId = string;
export type PlayerId = string;
export type ExoplanetId = string;
export type ReconnectToken = string;
export type CardId = string;
export type ModuleId = string;
export type FactoryId = string;

export type MaterialResource =
  | "energy"
  | "food"
  | "ore"
  | "metal"
  | "mre"
  | "teams";

export type Resource = "dollars" | MaterialResource;
export type ResourceBalances = Record<Resource, number>;
export type ResourceCost = Partial<Record<MaterialResource, number>>;
export type FactoryType = "rural" | "underground" | "industrial";
export type ModuleDefinitionId =
  | "solar-farm"
  | "farm"
  | "mine"
  | "smelter"
  | "mre-factory"
  | "training-center";

export interface ModuleInstance {
  id: ModuleId;
  definitionId: ModuleDefinitionId;
  ownerId: PlayerId | null;
}

export interface Factory {
  id: FactoryId;
  type: FactoryType;
  modules: ModuleInstance[];
}

export interface LobbyPlayer {
  id: PlayerId;
  name: string;
  connected: boolean;
  reconnectToken: ReconnectToken;
}

export interface Exoplanet {
  id: ExoplanetId;
  name: string;
  factorySlots: Array<Factory | null>;
  moduleDeck: ModuleInstance[];
  moduleDiscard: ModuleInstance[];
}

export interface ExoplanetSetup {
  id: ExoplanetId;
  name: string;
}

interface CardBase {
  id: CardId;
  ownerId: PlayerId;
}

export interface PauseCard extends CardBase {
  kind: "pause";
}

export interface PlayerSelectionCard extends CardBase {
  kind: "player";
  targetPlayerId: PlayerId;
}

export interface ExoplanetSelectionCard extends CardBase {
  kind: "exoplanet";
  targetExoplanetId: ExoplanetId;
}

export type TargetSelectionCard = PlayerSelectionCard | ExoplanetSelectionCard;
export type SelectionCard = PauseCard | TargetSelectionCard;

export interface GamePlayer extends LobbyPlayer {
  hand: SelectionCard[];
  playedCards: SelectionCard[];
  resources: ResourceBalances;
  heldModules: ModuleInstance[];
  homeFactories: Factory[];
}

export type ConnectionRewardLocation =
  | { kind: "home"; playerId: PlayerId }
  | { kind: "exoplanet"; exoplanetId: ExoplanetId };

export interface ActiveFactoryRun {
  factoryId: FactoryId;
  multiplier: number;
  nextModuleIndex: number;
}

export interface ConnectionRewardState {
  location: ConnectionRewardLocation;
  stage: "construction" | "production" | "complete";
  completedFactoryIds: FactoryId[];
  activeFactory: ActiveFactoryRun | null;
}

export type GamePhase = "connection-rewards" | "connection-round";

export type RoundPhase =
  | "initial-selection"
  | "pause-selection"
  | "resolved";

export type ResolutionStep = "initial" | "pause";

export interface PlayerConnection {
  kind: "player";
  playerIds: readonly [PlayerId, PlayerId];
  step: ResolutionStep;
}

export interface ExoplanetConnection {
  kind: "exoplanet";
  playerId: PlayerId;
  exoplanetId: ExoplanetId;
  step: ResolutionStep;
}

export interface SelfConnection {
  kind: "self";
  playerId: PlayerId;
  step: ResolutionStep;
}

export type Connection =
  | PlayerConnection
  | ExoplanetConnection
  | SelfConnection;

export type FailureReason =
  | "player-choice-not-mutual"
  | "exoplanet-contested"
  | "exoplanet-already-claimed";

export interface ConnectedPlayerResult {
  status: "connected";
  connection: Connection;
}

export interface FailedPlayerResult {
  status: "failed";
  reason: FailureReason;
}

export type PlayerResult = ConnectedPlayerResult | FailedPlayerResult;

export type UnresolvedEffect =
  | { kind: "trade"; playerIds: readonly [PlayerId, PlayerId] }
  | { kind: "compensation"; playerId: PlayerId };

export interface RoundResolution {
  connections: Connection[];
  playerResults: Record<PlayerId, PlayerResult>;
  unresolvedEffects: UnresolvedEffect[];
}

export interface RoundState {
  number: number;
  phase: RoundPhase;
  initialSelections: Partial<Record<PlayerId, SelectionCard>>;
  revealedInitialSelections: Record<PlayerId, SelectionCard> | null;
  pausePlayerIds: PlayerId[];
  pauseSelections: Partial<Record<PlayerId, TargetSelectionCard>>;
  revealedPauseSelections: Record<PlayerId, TargetSelectionCard> | null;
  resolution: RoundResolution | null;
}

export interface GameState {
  id: string;
  phase: GamePhase;
  playerOrder: PlayerId[];
  players: Record<PlayerId, GamePlayer>;
  exoplanets: Exoplanet[];
  connectionRewards: Partial<Record<PlayerId, ConnectionRewardState>>;
  round: RoundState;
}

export interface LobbyState {
  id: LobbyId;
  joinCode: string;
  hostPlayerId: PlayerId;
  status: "waiting" | "playing";
  players: Record<PlayerId, LobbyPlayer>;
  game: GameState | null;
}

export interface PublicRoundState
  extends Omit<RoundState, "initialSelections" | "pauseSelections"> {
  initialSelectionsSubmittedBy: PlayerId[];
  pauseSelectionsSubmittedBy: PlayerId[];
}

export interface PublicGamePlayer
  extends Omit<GamePlayer, "hand" | "reconnectToken"> {
  handSize: number;
}

export interface PublicGameState extends Omit<GameState, "players" | "round"> {
  players: Record<PlayerId, PublicGamePlayer>;
  round: PublicRoundState;
}

export interface GameSetupPlayer {
  id: PlayerId;
  name: string;
  reconnectToken: ReconnectToken;
}

export interface GameSetup {
  id: string;
  players: GameSetupPlayer[];
  exoplanets: ExoplanetSetup[];
}

export type FactoryConstructionTarget =
  | { kind: "new-factory" }
  | { kind: "factory"; factoryId: FactoryId }
  | { kind: "exoplanet-slot"; slotIndex: number };
