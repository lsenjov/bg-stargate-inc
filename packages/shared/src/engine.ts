import type {
  CardId,
  Connection,
  Exoplanet,
  ExoplanetId,
  ExoplanetSelectionCard,
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

export type GameRuleErrorCode =
  | "invalid-setup"
  | "unknown-player"
  | "wrong-phase"
  | "choice-already-submitted"
  | "card-unavailable"
  | "player-did-not-pause"
  | "pause-follow-up-must-target";

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
  exoplanets: Exoplanet[],
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
    });
  }

  return {
    id: setup.id,
    playerOrder,
    players,
    exoplanets: structuredClone(setup.exoplanets),
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
  if (current.round.phase !== "initial-selection") {
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

export function submitPauseSelection(
  current: GameState,
  playerId: PlayerId,
  cardId: CardId,
): GameState {
  if (current.round.phase !== "pause-selection") {
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
    } else if (connection.kind === "self") {
      effects.push({ kind: "internal-production", playerId: connection.playerId });
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
  return state;
}

export function startNextRound(current: GameState): GameState {
  if (current.round.phase !== "resolved") {
    throw new GameRuleError(
      "wrong-phase",
      "A new round can start only after resolution",
    );
  }
  const next = cloneGameState(current);
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
