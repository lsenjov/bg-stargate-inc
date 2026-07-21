export type FeatureStatus = "playable" | "planned" | "unresolved";

export interface GameFeature {
  id: string;
  area: string;
  name: string;
  status: FeatureStatus;
  rule: string;
}

export const gameFeatures = [
  {
    id: "online-lobbies",
    area: "online-play",
    name: "Online lobbies and reconnection",
    status: "playable",
    rule: "Players create or join a server-hosted lobby for 3 to 8 players and can securely reconnect to their seat.",
  },
  {
    id: "host-controlled-start",
    area: "online-play",
    name: "Host-controlled game start",
    status: "playable",
    rule: "Only the host may start a game, once the lobby has 3 to 8 players and every seated player is connected.",
  },
  {
    id: "public-gestures",
    area: "online-play",
    name: "Public gestures",
    status: "playable",
    rule: "Players may send fixed, public, non-binding gestures aimed at other connected players or the current game's exoplanets.",
  },
  {
    id: "secret-simultaneous-selection",
    area: "connection-round",
    name: "Secret simultaneous selection",
    status: "playable",
    rule: "Each player secretly chooses one available selection card before all choices are revealed.",
  },
  {
    id: "selection-undo",
    area: "connection-round",
    name: "Selection undo",
    status: "playable",
    rule: "A player may withdraw their hidden locked choice while its initial or pause selection phase remains open, then choose again before the same deadline.",
  },
  {
    id: "timed-auto-self-selection",
    area: "connection-round",
    name: "Timed automatic self-selection",
    status: "playable",
    rule: "Each initial and pause selection phase has a 30-second server deadline; when it expires, every eligible player without a locked choice automatically chooses themself.",
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
    id: "repeated-round-advancement",
    area: "connection-round",
    name: "Repeated round advancement",
    status: "playable",
    rule: "After resolution and every eligible factory operator finishes their connection action, any player may advance to the next numbered connection round, with card state carried forward under the exhaustion and reset rules.",
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
    name: "Factory production",
    status: "playable",
    rule: "Home planets have unlimited factory slots and exoplanets begin with three empty slots. After a self- or exoplanet connection, the connected player chooses unrun factories in any order for 1x, 2x, 3x, and later dollar running-cost multipliers. Each factory resolves oldest-first until stopped; inputs are not multiplied, outputs are available immediately, and an exoplanet visitor pays every cost and receives every output regardless of module ownership.",
  },
  {
    id: "module-schema",
    area: "rewards",
    name: "Module card schema",
    status: "playable",
    rule: "Every module has a name, type, construction cost, running cost, optional inputs, and outputs. Installation sets its owner.",
  },
  {
    id: "starting-module-setup",
    area: "rewards",
    name: "Starting module inventory",
    status: "playable",
    rule: "Each player begins with $20; 6 Energy, 1 Food, 8 Metal, and 2 MRE; no Ore or Teams; and one held copy of each module: Solar Farm — Rural; construction 1 Metal; running $1; no inputs; output 3 Energy. Farm — Rural; construction 1 Metal and 2 Energy; running $1; input 1 Energy; output 1 Food. Mine — Underground; construction 1 Food and 2 Energy; running $1; input 1 Energy; output 1 Ore. Smelter — Industrial; construction 2 Metal; running $1; inputs 1 Energy and 1 Ore; output 1 Metal. MRE Factory — Industrial; construction 2 Metal; running $1; inputs 1 Energy and 1 Food; output 1 MRE. Training Center — Underground; construction 2 MRE, 2 Metal, and 2 Energy; running $2; inputs 1 Energy, 1 MRE, and 1 Metal; output 1 Team.",
  },
  {
    id: "module-acquisition",
    area: "rewards",
    name: "Exoplanet module acquisition",
    status: "planned",
    rule: "Exoplanet module decks and discard piles are currently empty. Planned acquisition lets a connected player spend Teams to keep one revealed or discarded module; kept modules remain held for later construction.",
  },
  {
    id: "module-construction",
    area: "rewards",
    name: "Module construction and ownership",
    status: "playable",
    rule: "After a self- or exoplanet connection, a player may pay any held module's construction cost to install and own it at that location before beginning production. It may extend a same-type factory or create a permanent factory in an available slot; exoplanet construction also costs one Team. Unbuilt modules remain held for later connections.",
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
    rule: "Contracts, scoring, and the game objective are not yet defined.",
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
export type FeatureArea = (typeof gameFeatures)[number]["area"];

export const playableFeatureIds = gameFeatures
  .filter((feature) => feature.status === "playable")
  .map((feature) => feature.id);

export function getFeature(id: GameFeatureId) {
  return gameFeatures.find((feature) => feature.id === id);
}

export function groupFeaturesByArea(
  features: readonly GameFeature[] = gameFeatures,
): Array<{ id: string; name: string; features: readonly GameFeature[] }> {
  const groups = new Map<string, GameFeature[]>();
  for (const feature of features) {
    const areaFeatures = groups.get(feature.area) ?? [];
    areaFeatures.push(feature);
    groups.set(feature.area, areaFeatures);
  }
  return [...groups].map(([id, areaFeatures]) => ({
    id,
    name: id
      .split("-")
      .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
      .join(" "),
    features: areaFeatures,
  }));
}

export function summarizeFeatureScope(
  features: readonly GameFeature[] = gameFeatures,
): string {
  const byStatus = new Map<FeatureStatus, string[]>();
  for (const feature of features) {
    const names = byStatus.get(feature.status) ?? [];
    names.push(feature.name);
    byStatus.set(feature.status, names);
  }
  return [...byStatus]
    .map(([status, names]) =>
      `${status[0]?.toUpperCase() ?? ""}${status.slice(1)}: ${names.join(", ")}.`
    )
    .join(" ");
}
