import { describe, expect, it } from "vitest";

import {
  gameFeatures,
  getFeature,
  groupFeaturesByArea,
  playableFeatureIds,
  summarizeFeatureScope,
  type GameFeature,
} from "./features.js";

describe("feature manifest", () => {
  it("uses unique IDs and recognized statuses", () => {
    expect(new Set(gameFeatures.map(({ id }) => id)).size).toBe(
      gameFeatures.length,
    );
    expect(
      gameFeatures.every(({ status }) =>
        ["playable", "planned", "unresolved"].includes(status),
      ),
    ).toBe(true);
  });

  it("marks every implemented connection rule as playable", () => {
    expect(playableFeatureIds).toEqual([
      "online-lobbies",
      "host-controlled-start",
      "public-gestures",
      "secret-simultaneous-selection",
      "selection-undo",
      "timed-auto-self-selection",
      "played-card-exhaustion",
      "pause-follow-up",
      "mutual-player-connection",
      "exclusive-exoplanet-connection",
      "pause-exoplanet-retry",
      "self-connection-reset",
      "repeated-round-advancement",
      "internal-production-reward",
      "module-schema",
      "starting-module-setup",
      "module-construction",
    ]);
  });

  it("states the playable lobby start and repeated-round conditions", () => {
    expect(getFeature("host-controlled-start")?.rule).toContain(
      "3 to 8 players",
    );
    expect(getFeature("host-controlled-start")?.rule).toContain(
      "every seated player is connected",
    );
    expect(getFeature("repeated-round-advancement")?.rule).toContain(
      "After resolution and every eligible factory operator finishes",
    );
    expect(getFeature("repeated-round-advancement")?.rule).toContain(
      "card state carried forward",
    );
  });

  it("states the playable public gesture limits", () => {
    const gestures = getFeature("public-gestures");

    expect(gestures?.status).toBe("playable");
    expect(gestures?.rule).toContain("fixed, public, non-binding");
    expect(gestures?.rule).toContain("other connected players");
    expect(gestures?.rule).toContain("current game's exoplanets");
  });

  it("states the playable selection undo and deadline rules", () => {
    const undo = getFeature("selection-undo");
    const deadline = getFeature("timed-auto-self-selection");

    expect(undo?.status).toBe("playable");
    expect(undo?.rule).toContain("hidden locked choice");
    expect(undo?.rule).toContain("initial or pause selection phase remains open");
    expect(undo?.rule).toContain("same deadline");
    expect(deadline?.status).toBe("playable");
    expect(deadline?.rule).toContain("30-second server deadline");
    expect(deadline?.rule).toContain("without a locked choice");
    expect(deadline?.rule).toContain("automatically chooses themself");
  });

  it("keeps undefined rewards visibly unresolved", () => {
    expect(getFeature("trade-reward")?.status).toBe("unresolved");
    expect(getFeature("failed-connection-compensation")?.status).toBe(
      "unresolved",
    );
    expect(getFeature("economy-and-scoring")?.status).toBe("unresolved");
    expect(getFeature("economy-and-scoring")?.rule).toContain(
      "scoring, and the game objective",
    );
  });

  it("marks factory and construction rules playable while acquisition stays planned", () => {
    const playableFactoryFeatureIds = [
      "internal-production-reward",
      "module-schema",
      "starting-module-setup",
      "module-construction",
    ] as const;

    for (const id of playableFactoryFeatureIds) {
      expect(getFeature(id)?.status).toBe("playable");
      expect(playableFeatureIds).toContain(id);
    }
    expect(getFeature("module-acquisition")?.status).toBe("planned");
    expect(playableFeatureIds).not.toContain("module-acquisition");
  });

  it("states the module schema and exact starting setup", () => {
    expect(getFeature("module-schema")?.rule).toBe(
      "Every module has a name, type, construction cost, running cost, optional inputs, and outputs. Installation sets its owner.",
    );
    expect(getFeature("starting-module-setup")?.rule).toBe(
      "Each player begins with $20; 6 Energy, 1 Food, 8 Metal, and 2 MRE; no Ore or Teams; and one held copy of each module: Solar Farm — Rural; construction 1 Metal; running $1; no inputs; output 3 Energy. Farm — Rural; construction 1 Metal and 2 Energy; running $1; input 1 Energy; output 1 Food. Mine — Underground; construction 1 Food and 2 Energy; running $1; input 1 Energy; output 1 Ore. Smelter — Industrial; construction 2 Metal; running $1; inputs 1 Energy and 1 Ore; output 1 Metal. MRE Factory — Industrial; construction 2 Metal; running $1; inputs 1 Energy and 1 Food; output 1 MRE. Training Center — Underground; construction 2 MRE, 2 Metal, and 2 Energy; running $2; inputs 1 Energy, 1 MRE, and 1 Metal; output 1 Team.",
    );
  });

  it("states factory production order and cost scaling", () => {
    const production = getFeature("internal-production-reward");

    expect(production?.rule).toContain("unlimited factory slots");
    expect(production?.status).toBe("playable");
    expect(production?.rule).toContain("exoplanets begin with three empty slots");
    expect(production?.rule).toContain("self- or exoplanet connection");
    expect(production?.rule).toContain("chooses unrun factories in any order");
    expect(production?.rule).toContain("1x, 2x, 3x");
    expect(production?.rule).toContain("inputs are not multiplied");
    expect(production?.rule).toContain("outputs are available immediately");
    expect(production?.rule).toContain("regardless of module ownership");
  });

  it("states module acquisition limits", () => {
    const acquisition = getFeature("module-acquisition");

    expect(acquisition?.status).toBe("planned");
    expect(acquisition?.rule).toContain("currently empty");
    expect(acquisition?.rule).toContain("spend Teams");
    expect(acquisition?.rule).toContain("remain held for later construction");
  });

  it("states module construction, type, ownership, and location costs", () => {
    const construction = getFeature("module-construction");

    expect(construction?.rule).toContain("construction cost");
    expect(construction?.rule).toContain("at that location");
    expect(construction?.rule).toContain("same-type factory");
    expect(construction?.rule).toContain("permanent factory");
    expect(construction?.rule).toContain("own it");
    expect(construction?.rule).toContain("also costs one Team");
    expect(construction?.rule).toContain("remain held for later connections");
  });

  it("derives every area and scope statement from the supplied manifest", () => {
    const features = [
      {
        id: "future-playable",
        area: "future-area",
        name: "Future playable",
        status: "playable",
        rule: "A future rule.",
      },
      {
        id: "future-planned",
        area: "another-new-area",
        name: "Future planned",
        status: "planned",
        rule: "Another future rule.",
      },
    ] satisfies readonly GameFeature[];

    expect(groupFeaturesByArea(features).map(({ id, name }) => ({ id, name })))
      .toEqual([
        { id: "future-area", name: "Future Area" },
        { id: "another-new-area", name: "Another New Area" },
      ]);
    expect(summarizeFeatureScope(features)).toBe(
      "Playable: Future playable. Planned: Future planned.",
    );
  });
});
