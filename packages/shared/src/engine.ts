import type {
  CardId,
  Connection,
  ConnectionRewardState,
  ExoplanetId,
  ExoplanetSelectionCard,
  ExoplanetSetup,
  Factory,
  FactoryConstructionTarget,
  FailureReason,
  GamePlayer,
  GameSetup,
  GameState,
  PauseCard,
  PlayerId,
  PlayerResult,
  PlayerSelectionCard,
  PublicGameState,
  RoundResolution,
  RoundState,
  SelectionCard,
  TargetSelectionCard,
  UnresolvedEffect,
} from "./model.js";
import {
  createStartingModules,
  getModuleDefinition,
  materialResources,
  startingResources,
} from "./modules.js";

export type GameRuleErrorCode =
  | "invalid-setup"
  | "unknown-player"
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

export class GameRuleError extends Error {
  constructor(
    public readonly code: GameRuleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GameRuleError";
  }
}

function createPlayerRecord<T>(): Record<PlayerId, T> {
  return Object.create(null) as Record<PlayerId, T>;
}

function setPlayerRecordValue<T>(
  record: Partial<Record<PlayerId, T>>,
  playerId: PlayerId,
  value: T,
): void {
  Object.defineProperty(record, playerId, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function copyPlayerRecord<T>(
  source: Partial<Record<PlayerId, T>>,
): Record<PlayerId, T> {
  const copy = createPlayerRecord<T>();
  for (const playerId of Object.keys(source)) {
    const value = source[playerId];
    if (value !== undefined) {
      setPlayerRecordValue<T>(copy, playerId, value);
    }
  }
  return copy;
}

function cloneGameState(state: GameState): GameState {
  const clone = structuredClone(state);
  clone.players = copyPlayerRecord(clone.players);
  clone.round.initialSelections = copyPlayerRecord(
    clone.round.initialSelections,
  );
  clone.round.pauseSelections = copyPlayerRecord(clone.round.pauseSelections);
  if (clone.round.revealedInitialSelections) {
    clone.round.revealedInitialSelections = copyPlayerRecord(
      clone.round.revealedInitialSelections,
    );
  }
  if (clone.round.revealedPauseSelections) {
    clone.round.revealedPauseSelections = copyPlayerRecord(
      clone.round.revealedPauseSelections,
    );
  }
  if (clone.round.resolution) {
    clone.round.resolution.playerResults = copyPlayerRecord(
      clone.round.resolution.playerResults,
    );
  }
  clone.connectionRewards = copyPlayerRecord(clone.connectionRewards);
  return clone;
}

export function playerCardId(ownerId: PlayerId, targetId: PlayerId): CardId {
  return `player:${ownerId}:${targetId}`;
}

export function exoplanetCardId(
  ownerId: PlayerId,
  exoplanetId: ExoplanetId,
): CardId {
  return `exoplanet:${ownerId}:${exoplanetId}`;
}

export function pauseCardId(ownerId: PlayerId): CardId {
  return `pause:${ownerId}`;
}

function createPlayerCards(
  ownerId: PlayerId,
  playerIds: PlayerId[],
  exoplanets: ExoplanetSetup[],
): SelectionCard[] {
  const playerCards: PlayerSelectionCard[] = playerIds.map((targetPlayerId) => ({
    id: playerCardId(ownerId, targetPlayerId),
    kind: "player",
    ownerId,
    targetPlayerId,
  }));
  const exoplanetCards: ExoplanetSelectionCard[] = exoplanets.map(
    ({ id: targetExoplanetId }) => ({
      id: exoplanetCardId(ownerId, targetExoplanetId),
      kind: "exoplanet",
      ownerId,
      targetExoplanetId,
    }),
  );
  const pauseCard: PauseCard = {
    id: pauseCardId(ownerId),
    kind: "pause",
    ownerId,
  };

  return [...playerCards, ...exoplanetCards, pauseCard];
}

function createRound(number: number): RoundState {
  return {
    number,
    phase: "initial-selection",
    initialSelections: createPlayerRecord(),
    revealedInitialSelections: null,
    pausePlayerIds: [],
    pauseSelections: createPlayerRecord(),
    revealedPauseSelections: null,
    resolution: null,
  };
}

function requireDistinctIds(values: string[], label: string): void {
  if (new Set(values).size !== values.length || values.some((value) => !value)) {
    throw new GameRuleError(
      "invalid-setup",
      `${label} must have distinct, non-empty IDs`,
    );
  }
}

export function createGame(setup: GameSetup): GameState {
  if (setup.players.length < 3 || setup.players.length > 8) {
    throw new GameRuleError("invalid-setup", "A game requires 3 to 8 players");
  }
  if (setup.exoplanets.length < 2 || setup.exoplanets.length > 4) {
    throw new GameRuleError("invalid-setup", "A game requires 2 to 4 exoplanets");
  }

  const playerOrder = setup.players.map(({ id }) => id);
  requireDistinctIds(playerOrder, "Players");
  requireDistinctIds(
    setup.exoplanets.map(({ id }) => id),
    "Exoplanets",
  );
  requireDistinctIds(
    setup.players.map(({ reconnectToken }) => reconnectToken),
    "Reconnect tokens",
  );

  const players = createPlayerRecord<GamePlayer>();
  for (const player of setup.players) {
    setPlayerRecordValue<GamePlayer>(players, player.id, {
      ...player,
      connected: true,
      hand: createPlayerCards(player.id, playerOrder, setup.exoplanets),
      playedCards: [],
      resources: structuredClone(startingResources),
      heldModules: createStartingModules(player.id),
      homeFactories: [],
    });
  }

  return {
    id: setup.id,
    phase: "connection-round",
    playerOrder,
    players,
    exoplanets: setup.exoplanets.map((exoplanet) => ({
      ...exoplanet,
      factorySlots: [null, null, null],
      moduleDeck: [],
      moduleDiscard: [],
    })),
    connectionRewards: createPlayerRecord(),
    round: createRound(1),
  };
}

function getPlayer(state: GameState, playerId: PlayerId): GamePlayer {
  if (!Object.hasOwn(state.players, playerId)) {
    throw new GameRuleError("unknown-player", `Unknown player: ${playerId}`);
  }
  const player = state.players[playerId];
  if (!player) {
    throw new GameRuleError("unknown-player", `Unknown player: ${playerId}`);
  }
  return player;
}

function getConnectionReward(
  state: GameState,
  playerId: PlayerId,
): ConnectionRewardState {
  const reward = state.connectionRewards[playerId];
  if (state.phase !== "connection-rewards" || !reward || reward.stage === "complete") {
    throw new GameRuleError(
      "connection-reward-unavailable",
      "This player does not have an active connection reward",
    );
  }
  return reward;
}

function canPay(
  player: GamePlayer,
  cost: Partial<Record<keyof GamePlayer["resources"], number>>,
): boolean {
  return Object.entries(cost).every(([resource, amount]) =>
    player.resources[resource as keyof GamePlayer["resources"]] >= (amount ?? 0)
  );
}

function payMaterialCost(
  player: GamePlayer,
  cost: Partial<Record<(typeof materialResources)[number], number>>,
): void {
  if (!canPay(player, cost)) {
    throw new GameRuleError(
      "insufficient-resources",
      "The player cannot afford this construction",
    );
  }
  for (const resource of materialResources) {
    player.resources[resource] -= cost[resource] ?? 0;
  }
}

function locationFactories(
  state: GameState,
  playerId: PlayerId,
  reward: ConnectionRewardState,
): Factory[] {
  if (reward.location.kind === "home") {
    return getPlayer(state, playerId).homeFactories;
  }
  const exoplanetId = reward.location.exoplanetId;
  const exoplanet = state.exoplanets.find(
    ({ id }) => id === exoplanetId,
  );
  if (!exoplanet) {
    throw new GameRuleError("factory-not-found", "Connection location not found");
  }
  return exoplanet.factorySlots.filter(
    (factory): factory is Factory => factory !== null,
  );
}

function createFactoryId(
  playerId: PlayerId,
  reward: ConnectionRewardState,
  index: number,
): string {
  return reward.location.kind === "home"
    ? `factory:home:${playerId}:${index}`
    : `factory:exoplanet:${reward.location.exoplanetId}:${index}`;
}

export function constructModule(
  current: GameState,
  playerId: PlayerId,
  moduleId: string,
  target: FactoryConstructionTarget,
): GameState {
  const currentPlayer = getPlayer(current, playerId);
  getConnectionReward(current, playerId);
  const heldModule = currentPlayer.heldModules.find(({ id }) => id === moduleId);
  if (!heldModule) {
    throw new GameRuleError(
      "module-unavailable",
      "The selected module is not held by this player",
    );
  }

  const next = cloneGameState(current);
  const player = getPlayer(next, playerId);
  const reward = getConnectionReward(next, playerId);
  if (reward.stage !== "construction") {
    throw new GameRuleError(
      "connection-reward-unavailable",
      "Construction has closed for this connection",
    );
  }
  const module = player.heldModules.find(({ id }) => id === moduleId)!;
  const definition = getModuleDefinition(module.definitionId);
  const constructionCost = { ...definition.constructionCost };
  if (reward.location.kind === "exoplanet") {
    constructionCost.teams = (constructionCost.teams ?? 0) + 1;
  }

  let factory: Factory;
  if (target.kind === "factory") {
    factory = locationFactories(next, playerId, reward).find(
      ({ id }) => id === target.factoryId,
    )!;
    if (!factory) {
      throw new GameRuleError(
        "factory-not-found",
        "The selected factory is not at this connection",
      );
    }
    if (factory.type !== definition.type) {
      throw new GameRuleError(
        "factory-type-mismatch",
        "Every module in a factory must have the same type",
      );
    }
    if (
      reward.completedFactoryIds.includes(factory.id) ||
      reward.activeFactory?.factoryId === factory.id
    ) {
      throw new GameRuleError(
        "factory-already-operated",
        "A factory cannot receive modules after operating during this connection",
      );
    }
  } else if (reward.location.kind === "home" && target.kind === "new-factory") {
    factory = {
      id: createFactoryId(playerId, reward, player.homeFactories.length),
      type: definition.type,
      modules: [],
    };
    player.homeFactories.push(factory);
  } else if (
    reward.location.kind === "exoplanet" &&
    target.kind === "exoplanet-slot"
  ) {
    const exoplanetId = reward.location.exoplanetId;
    const exoplanet = next.exoplanets.find(
      ({ id }) => id === exoplanetId,
    )!;
    if (
      !Number.isInteger(target.slotIndex) ||
      target.slotIndex < 0 ||
      target.slotIndex >= exoplanet.factorySlots.length ||
      exoplanet.factorySlots[target.slotIndex] !== null
    ) {
      throw new GameRuleError(
        "factory-slot-unavailable",
        "The selected exoplanet factory slot is unavailable",
      );
    }
    factory = {
      id: createFactoryId(playerId, reward, target.slotIndex),
      type: definition.type,
      modules: [],
    };
    exoplanet.factorySlots[target.slotIndex] = factory;
  } else {
    throw new GameRuleError(
      "factory-slot-unavailable",
      "This construction target is invalid at the connected location",
    );
  }

  payMaterialCost(player, constructionCost);
  factory.modules.push({ ...module, ownerId: playerId });
  player.heldModules = player.heldModules.filter(({ id }) => id !== moduleId);
  return next;
}

function requireProductionReward(
  state: GameState,
  playerId: PlayerId,
): ConnectionRewardState {
  const reward = getConnectionReward(state, playerId);
  if (reward.stage !== "production") {
    throw new GameRuleError(
      "factory-run-unavailable",
      "Factory production has not started for this connection",
    );
  }
  return reward;
}

export function beginProduction(
  current: GameState,
  playerId: PlayerId,
): GameState {
  const reward = getConnectionReward(current, playerId);
  if (reward.stage !== "construction") {
    throw new GameRuleError(
      "factory-run-unavailable",
      "Factory production has already started",
    );
  }
  const next = cloneGameState(current);
  next.connectionRewards[playerId]!.stage = "production";
  return next;
}

function payModuleRun(
  player: GamePlayer,
  factory: Factory,
  moduleIndex: number,
  multiplier: number,
): void {
  const module = factory.modules[moduleIndex];
  if (!module) {
    throw new GameRuleError(
      "factory-run-unavailable",
      "Every module in this factory has already operated",
    );
  }
  const definition = getModuleDefinition(module.definitionId);
  const dollarCost = definition.runningCost * multiplier;
  if (
    player.resources.dollars < dollarCost ||
    !canPay(player, definition.inputs)
  ) {
    throw new GameRuleError(
      "insufficient-resources",
      "The player cannot afford to run this module",
    );
  }
  player.resources.dollars -= dollarCost;
  for (const resource of materialResources) {
    player.resources[resource] -= definition.inputs[resource] ?? 0;
    player.resources[resource] += definition.outputs[resource] ?? 0;
  }
}

export function runNextFactoryModule(
  current: GameState,
  playerId: PlayerId,
  factoryId: string,
): GameState {
  const currentReward = requireProductionReward(current, playerId);
  if (
    currentReward.activeFactory &&
    currentReward.activeFactory.factoryId !== factoryId
  ) {
    throw new GameRuleError(
      "factory-run-unavailable",
      "Finish or stop the active factory before choosing another",
    );
  }
  if (currentReward.completedFactoryIds.includes(factoryId)) {
    throw new GameRuleError(
      "factory-already-operated",
      "This factory has already operated during the connection",
    );
  }
  const currentFactory = locationFactories(current, playerId, currentReward).find(
    ({ id }) => id === factoryId,
  );
  if (!currentFactory) {
    throw new GameRuleError(
      "factory-not-found",
      "The selected factory is not at this connection",
    );
  }

  const next = cloneGameState(current);
  const player = getPlayer(next, playerId);
  const reward = requireProductionReward(next, playerId);
  const factory = locationFactories(next, playerId, reward).find(
    ({ id }) => id === factoryId,
  )!;
  reward.activeFactory ??= {
    factoryId,
    multiplier: reward.completedFactoryIds.length + 1,
    nextModuleIndex: 0,
  };
  const activeFactory = reward.activeFactory;
  payModuleRun(
    player,
    factory,
    activeFactory.nextModuleIndex,
    activeFactory.multiplier,
  );
  activeFactory.nextModuleIndex += 1;
  if (activeFactory.nextModuleIndex === factory.modules.length) {
    reward.completedFactoryIds.push(factoryId);
    reward.activeFactory = null;
  }
  return next;
}

export function stopActiveFactory(
  current: GameState,
  playerId: PlayerId,
): GameState {
  const currentReward = requireProductionReward(current, playerId);
  if (!currentReward.activeFactory) {
    throw new GameRuleError(
      "factory-run-unavailable",
      "This player does not have an active factory",
    );
  }
  const next = cloneGameState(current);
  const reward = requireProductionReward(next, playerId);
  reward.completedFactoryIds.push(reward.activeFactory!.factoryId);
  reward.activeFactory = null;
  return next;
}

export function finishConnectionReward(
  current: GameState,
  playerId: PlayerId,
): GameState {
  const currentReward = getConnectionReward(current, playerId);
  if (currentReward.activeFactory) {
    throw new GameRuleError(
      "factory-run-unavailable",
      "Finish or stop the active factory before ending the connection",
    );
  }
  const next = cloneGameState(current);
  next.connectionRewards[playerId]!.stage = "complete";
  const allComplete = Object.values(next.connectionRewards).every(
    (reward) => reward?.stage === "complete",
  );
  if (allComplete) {
    next.phase = "connection-round";
  }
  return next;
}

function allPlayersSubmitted(
  playerIds: PlayerId[],
  selections: Partial<Record<PlayerId, SelectionCard>>,
): boolean {
  return playerIds.every((playerId) => Object.hasOwn(selections, playerId));
}

function revealSelections<T extends SelectionCard>(
  playerIds: PlayerId[],
  selections: Partial<Record<PlayerId, T>>,
): Record<PlayerId, T> {
  const revealed = createPlayerRecord<T>();
  for (const playerId of playerIds) {
    if (!Object.hasOwn(selections, playerId)) {
      throw new Error(`Selection missing for ${playerId}`);
    }
    const selection = selections[playerId];
    if (!selection) {
      throw new Error(`Selection missing for ${playerId}`);
    }
    setPlayerRecordValue(revealed, playerId, selection);
  }
  return revealed;
}

function playCard(player: GamePlayer, card: SelectionCard): void {
  player.hand = player.hand.filter(({ id }) => id !== card.id);
  player.playedCards.push(card);
}

export function submitInitialSelection(
  current: GameState,
  playerId: PlayerId,
  cardId: CardId,
): GameState {
  if (
    current.phase !== "connection-round" ||
    current.round.phase !== "initial-selection"
  ) {
    throw new GameRuleError(
      "wrong-phase",
      "Initial selections are closed for this round",
    );
  }
  if (Object.hasOwn(current.round.initialSelections, playerId)) {
    throw new GameRuleError(
      "choice-already-submitted",
      "This player already submitted an initial selection",
    );
  }

  const currentPlayer = getPlayer(current, playerId);
  const card = currentPlayer.hand.find(({ id }) => id === cardId);
  if (!card) {
    throw new GameRuleError(
      "card-unavailable",
      "The selected card is not in this player's hand",
    );
  }

  const next = cloneGameState(current);
  setPlayerRecordValue(next.round.initialSelections, playerId, card);
  if (!allPlayersSubmitted(next.playerOrder, next.round.initialSelections)) {
    return next;
  }

  const revealed = revealSelections(
    next.playerOrder,
    next.round.initialSelections,
  );
  next.round.revealedInitialSelections = revealed;
  for (const submittedPlayerId of next.playerOrder) {
    playCard(next.players[submittedPlayerId]!, revealed[submittedPlayerId]!);
  }
  next.round.pausePlayerIds = next.playerOrder.filter(
    (submittedPlayerId) => revealed[submittedPlayerId]?.kind === "pause",
  );

  if (next.round.pausePlayerIds.length > 0) {
    next.round.phase = "pause-selection";
    return next;
  }

  return finalizeRound(next);
}

export function undoInitialSelection(
  current: GameState,
  playerId: PlayerId,
): GameState {
  if (
    current.phase !== "connection-round" ||
    current.round.phase !== "initial-selection"
  ) {
    throw new GameRuleError(
      "wrong-phase",
      "Initial selections are closed for this round",
    );
  }
  getPlayer(current, playerId);
  if (!Object.hasOwn(current.round.initialSelections, playerId)) {
    throw new GameRuleError(
      "selection-not-submitted",
      "This player has not submitted an initial selection",
    );
  }

  const next = cloneGameState(current);
  delete next.round.initialSelections[playerId];
  return next;
}

export function submitPauseSelection(
  current: GameState,
  playerId: PlayerId,
  cardId: CardId,
): GameState {
  if (
    current.phase !== "connection-round" ||
    current.round.phase !== "pause-selection"
  ) {
    throw new GameRuleError(
      "wrong-phase",
      "Pause follow-up selections are not open",
    );
  }
  if (!current.round.pausePlayerIds.includes(playerId)) {
    throw new GameRuleError(
      "player-did-not-pause",
      "Only a player who revealed pause may submit a follow-up",
    );
  }
  if (Object.hasOwn(current.round.pauseSelections, playerId)) {
    throw new GameRuleError(
      "choice-already-submitted",
      "This player already submitted a pause follow-up",
    );
  }

  const currentPlayer = getPlayer(current, playerId);
  const card = currentPlayer.hand.find(({ id }) => id === cardId);
  if (!card) {
    throw new GameRuleError(
      "card-unavailable",
      "The selected card is not in this player's hand",
    );
  }
  if (card.kind === "pause") {
    throw new GameRuleError(
      "pause-follow-up-must-target",
      "A pause follow-up must target a player or exoplanet",
    );
  }

  const next = cloneGameState(current);
  setPlayerRecordValue(next.round.pauseSelections, playerId, card);
  if (
    !allPlayersSubmitted(
      next.round.pausePlayerIds,
      next.round.pauseSelections,
    )
  ) {
    return next;
  }

  const revealed = revealSelections(
    next.round.pausePlayerIds,
    next.round.pauseSelections,
  );
  next.round.revealedPauseSelections = revealed;
  for (const pausePlayerId of next.round.pausePlayerIds) {
    playCard(next.players[pausePlayerId]!, revealed[pausePlayerId]!);
  }

  return finalizeRound(next);
}

export function undoPauseSelection(
  current: GameState,
  playerId: PlayerId,
): GameState {
  if (
    current.phase !== "connection-round" ||
    current.round.phase !== "pause-selection"
  ) {
    throw new GameRuleError(
      "wrong-phase",
      "Pause follow-up selections are not open",
    );
  }
  getPlayer(current, playerId);
  if (!current.round.pausePlayerIds.includes(playerId)) {
    throw new GameRuleError(
      "player-did-not-pause",
      "Only a player who revealed pause may undo a follow-up",
    );
  }
  if (!Object.hasOwn(current.round.pauseSelections, playerId)) {
    throw new GameRuleError(
      "selection-not-submitted",
      "This player has not submitted a pause follow-up",
    );
  }

  const next = cloneGameState(current);
  delete next.round.pauseSelections[playerId];
  return next;
}

function choiceFor(
  state: GameState,
  playerId: PlayerId,
): TargetSelectionCard {
  const choice = state.round.pausePlayerIds.includes(playerId)
    ? state.round.revealedPauseSelections?.[playerId]
    : state.round.revealedInitialSelections?.[playerId];
  if (!choice || choice.kind === "pause") {
    throw new Error(`Target selection missing for ${playerId}`);
  }
  return choice;
}

function claimantCounts(
  playerIds: PlayerId[],
  selections: Record<PlayerId, SelectionCard> | null,
): Map<ExoplanetId, number> {
  const counts = new Map<ExoplanetId, number>();
  if (!selections) {
    return counts;
  }
  for (const playerId of playerIds) {
    const selection = selections[playerId];
    if (selection?.kind === "exoplanet") {
      counts.set(
        selection.targetExoplanetId,
        (counts.get(selection.targetExoplanetId) ?? 0) + 1,
      );
    }
  }
  return counts;
}

function connectionForPlayer(
  state: GameState,
  playerId: PlayerId,
  initialClaims: Map<ExoplanetId, number>,
  pauseClaims: Map<ExoplanetId, number>,
): Connection | null {
  const choice = choiceFor(state, playerId);
  const isPausePlayer = state.round.pausePlayerIds.includes(playerId);
  const step = isPausePlayer ? "pause" : "initial";

  if (choice.kind === "player") {
    if (choice.targetPlayerId === playerId) {
      return { kind: "self", playerId, step };
    }
    const targetChoice = choiceFor(state, choice.targetPlayerId);
    if (
      targetChoice.kind !== "player" ||
      targetChoice.targetPlayerId !== playerId
    ) {
      return null;
    }
    const playerIds = state.playerOrder.indexOf(playerId) <
      state.playerOrder.indexOf(choice.targetPlayerId)
      ? ([playerId, choice.targetPlayerId] as const)
      : ([choice.targetPlayerId, playerId] as const);
    return {
      kind: "player",
      playerIds,
      step:
        isPausePlayer || state.round.pausePlayerIds.includes(choice.targetPlayerId)
          ? "pause"
          : "initial",
    };
  }

  const initialCount = initialClaims.get(choice.targetExoplanetId) ?? 0;
  if (!isPausePlayer && initialCount === 1) {
    return {
      kind: "exoplanet",
      playerId,
      exoplanetId: choice.targetExoplanetId,
      step,
    };
  }
  const pauseCount = pauseClaims.get(choice.targetExoplanetId) ?? 0;
  if (isPausePlayer && initialCount !== 1 && pauseCount === 1) {
    return {
      kind: "exoplanet",
      playerId,
      exoplanetId: choice.targetExoplanetId,
      step,
    };
  }
  return null;
}

function failureReason(
  state: GameState,
  playerId: PlayerId,
  initialClaims: Map<ExoplanetId, number>,
): FailureReason {
  const choice = choiceFor(state, playerId);
  if (choice.kind === "player") {
    return "player-choice-not-mutual";
  }
  if (
    state.round.pausePlayerIds.includes(playerId) &&
    initialClaims.get(choice.targetExoplanetId) === 1
  ) {
    return "exoplanet-already-claimed";
  }
  return "exoplanet-contested";
}

function uniqueConnections(
  state: GameState,
  byPlayer: Map<PlayerId, Connection>,
): Connection[] {
  const seenPlayerPairs = new Set<string>();
  const connections: Connection[] = [];
  for (const playerId of state.playerOrder) {
    const connection = byPlayer.get(playerId);
    if (!connection) {
      continue;
    }
    if (connection.kind !== "player") {
      connections.push(connection);
      continue;
    }
    const key = connection.playerIds.join("\u0000");
    if (!seenPlayerPairs.has(key)) {
      connections.push(connection);
      seenPlayerPairs.add(key);
    }
  }
  return connections;
}

function effectsFor(
  connections: Connection[],
  playerResults: Record<PlayerId, PlayerResult>,
  playerOrder: PlayerId[],
): UnresolvedEffect[] {
  const effects: UnresolvedEffect[] = [];
  for (const connection of connections) {
    if (connection.kind === "player") {
      effects.push({ kind: "trade", playerIds: connection.playerIds });
    }
  }
  for (const playerId of playerOrder) {
    if (playerResults[playerId]?.status === "failed") {
      effects.push({ kind: "compensation", playerId });
    }
  }
  return effects;
}

function resolveRound(state: GameState): RoundResolution {
  const initialNonPausePlayers = state.playerOrder.filter(
    (playerId) => !state.round.pausePlayerIds.includes(playerId),
  );
  const initialClaims = claimantCounts(
    initialNonPausePlayers,
    state.round.revealedInitialSelections,
  );
  const pauseClaims = claimantCounts(
    state.round.pausePlayerIds,
    state.round.revealedPauseSelections,
  );
  const byPlayer = new Map<PlayerId, Connection>();
  const playerResults = createPlayerRecord<PlayerResult>();

  for (const playerId of state.playerOrder) {
    const connection = connectionForPlayer(
      state,
      playerId,
      initialClaims,
      pauseClaims,
    );
    if (connection) {
      byPlayer.set(playerId, connection);
      setPlayerRecordValue<PlayerResult>(playerResults, playerId, {
        status: "connected",
        connection,
      });
    } else {
      setPlayerRecordValue<PlayerResult>(playerResults, playerId, {
        status: "failed",
        reason: failureReason(state, playerId, initialClaims),
      });
    }
  }

  const connections = uniqueConnections(state, byPlayer);
  return {
    connections,
    playerResults,
    unresolvedEffects: effectsFor(
      connections,
      playerResults,
      state.playerOrder,
    ),
  };
}

function restorePlayedCards(player: GamePlayer): void {
  player.hand = [...player.hand, ...player.playedCards].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  player.playedCards = [];
}

function finalizeRound(state: GameState): GameState {
  state.round.resolution = resolveRound(state);
  state.round.phase = "resolved";
  for (const connection of state.round.resolution.connections) {
    if (connection.kind === "self") {
      restorePlayedCards(state.players[connection.playerId]!);
    }
  }
  const rewards = createPlayerRecord<ConnectionRewardState>();
  for (const connection of state.round.resolution.connections) {
    if (connection.kind === "self") {
      setPlayerRecordValue<ConnectionRewardState>(rewards, connection.playerId, {
        location: { kind: "home", playerId: connection.playerId },
        stage: "construction",
        completedFactoryIds: [],
        activeFactory: null,
      });
    } else if (connection.kind === "exoplanet") {
      setPlayerRecordValue<ConnectionRewardState>(rewards, connection.playerId, {
        location: {
          kind: "exoplanet",
          exoplanetId: connection.exoplanetId,
        },
        stage: "construction",
        completedFactoryIds: [],
        activeFactory: null,
      });
    }
  }
  state.connectionRewards = rewards;
  state.phase = Object.keys(rewards).length > 0
    ? "connection-rewards"
    : "connection-round";
  return state;
}

export function startNextRound(current: GameState): GameState {
  if (
    current.phase !== "connection-round" ||
    current.round.phase !== "resolved"
  ) {
    throw new GameRuleError(
      "wrong-phase",
      "A new round can start only after resolution",
    );
  }
  const next = cloneGameState(current);
  next.connectionRewards = createPlayerRecord();
  next.round = createRound(current.round.number + 1);
  return next;
}

export function toPublicGameState(state: GameState): PublicGameState {
  const clone = cloneGameState(state);
  const { initialSelections, pauseSelections, ...round } = clone.round;
  const players = createPlayerRecord<PublicGameState["players"][PlayerId]>();
  for (const playerId of clone.playerOrder) {
    const player = clone.players[playerId]!;
    setPlayerRecordValue(players, playerId, {
      id: player.id,
      name: player.name,
      connected: player.connected,
      playedCards: player.playedCards,
      resources: player.resources,
      heldModules: player.heldModules,
      homeFactories: player.homeFactories,
      handSize: player.hand.length,
    });
  }
  return {
    ...clone,
    players,
    round: {
      ...round,
      initialSelectionsSubmittedBy: state.playerOrder.filter(
        (playerId) => Object.hasOwn(initialSelections, playerId),
      ),
      pauseSelectionsSubmittedBy: state.round.pausePlayerIds.filter(
        (playerId) => Object.hasOwn(pauseSelections, playerId),
      ),
    },
  };
}
