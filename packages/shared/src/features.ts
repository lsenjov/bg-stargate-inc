export type FeatureStatus = "playable" | "planned" | "unresolved";

export type FeatureArea =
  | "online-play"
  | "connection-round"
  | "rewards"
  | "full-game";

export interface GameFeature {
  id: string;
  area: FeatureArea;
  name: string;
  status: FeatureStatus;
  rule: string;
}

export const gameFeatures = [
  {
    id: "online-lobbies",
    area: "online-play",
    name: "Online lobbies and reconnection",
    status: "planned",
    rule: "Players will join a server-hosted lobby and reconnect to an active game.",
  },
  {
    id: "secret-simultaneous-selection",
    area: "connection-round",
    name: "Secret simultaneous selection",
    status: "playable",
    rule: "Each player secretly chooses one available selection card before all choices are revealed.",
  },
  {
    id: "played-card-exhaustion",
    area: "connection-round",
    name: "Played cards stay face up",
    status: "playable",
    rule: "Played cards leave the hand and cannot be chosen again until returned by a self-connection.",
  },
  {
    id: "pause-follow-up",
    area: "connection-round",
    name: "Pause follow-up",
    status: "playable",
    rule: "Pause players see non-pause choices, then simultaneously choose a target card from hand.",
  },
  {
    id: "mutual-player-connection",
    area: "connection-round",
    name: "Mutual player connection",
    status: "playable",
    rule: "Two players connect only when they choose each other in the applicable resolution steps.",
  },
  {
    id: "exclusive-exoplanet-connection",
    area: "connection-round",
    name: "Exclusive exoplanet connection",
    status: "playable",
    rule: "One claimant connects to an exoplanet; simultaneous claimants fail.",
  },
  {
    id: "pause-exoplanet-retry",
    area: "connection-round",
    name: "Pause exoplanet retry",
    status: "playable",
    rule: "A sole pause claimant may connect after an initial contest, but cannot displace a successful claimant.",
  },
  {
    id: "self-connection-reset",
    area: "connection-round",
    name: "Self-connection card reset",
    status: "playable",
    rule: "Choosing yourself connects and returns all of your face-up selection cards to hand.",
  },
  {
    id: "trade-reward",
    area: "rewards",
    name: "Trade reward",
    status: "unresolved",
    rule: "A mutual player connection permits trade, whose contents and constraints are not defined.",
  },
  {
    id: "internal-production-reward",
    area: "rewards",
    name: "Internal production reward",
    status: "unresolved",
    rule: "A self-connection produces internally, but its reward is not defined.",
  },
  {
    id: "failed-connection-compensation",
    area: "rewards",
    name: "Failed connection compensation",
    status: "unresolved",
    rule: "A player who fails to connect receives a small action that is not yet defined.",
  },
  {
    id: "economy-and-scoring",
    area: "full-game",
    name: "Economy and scoring",
    status: "unresolved",
    rule: "Resources, contracts, scoring, and the game objective are not yet defined.",
  },
  {
    id: "board-and-end-game",
    area: "full-game",
    name: "Board and end game",
    status: "unresolved",
    rule: "The network board, wider turn loop, and end-game trigger are not yet defined.",
  },
] as const satisfies readonly GameFeature[];

export type GameFeatureId = (typeof gameFeatures)[number]["id"];

export const playableFeatureIds = gameFeatures
  .filter((feature) => feature.status === "playable")
  .map((feature) => feature.id);

export function getFeature(id: GameFeatureId) {
  return gameFeatures.find((feature) => feature.id === id);
}
