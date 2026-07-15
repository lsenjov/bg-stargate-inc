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
      "After resolution",
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

  it("marks factory and module rules as planned rather than playable", () => {
    const plannedFeatureIds = [
      "internal-production-reward",
      "module-acquisition",
      "module-construction",
    ] as const;

    for (const id of plannedFeatureIds) {
      expect(getFeature(id)?.status).toBe("planned");
      expect(playableFeatureIds).not.toContain(id);
    }
  });

  it("states factory production order and cost scaling", () => {
    const production = getFeature("internal-production-reward");

    expect(production?.rule).toContain("unlimited factory slots");
    expect(production?.rule).toContain("exoplanets begin with three");
    expect(production?.rule).toContain("any number of modules of one type");
    expect(production?.rule).toContain("self- or exoplanet connection");
    expect(production?.rule).toContain("oldest-first until the player stops");
    expect(production?.rule).toContain("1x, 2x, 3x");
    expect(production?.rule).toContain(
      "without changing earlier factories' multipliers",
    );
  });

  it("states module acquisition limits", () => {
    const acquisition = getFeature("module-acquisition");

    expect(acquisition?.rule).toContain(
      "reveal one more module than Teams spent",
    );
    expect(acquisition?.rule).toContain("spend one Team to choose one");
    expect(acquisition?.rule).toContain("At most one module");
    expect(acquisition?.rule).toContain("per turn");
  });

  it("states module construction, type, ownership, and location costs", () => {
    const construction = getFeature("module-construction");

    expect(construction?.rule).toContain("construction cost");
    expect(construction?.rule).toContain("at that location");
    expect(construction?.rule).toContain("matching the factory's module type");
    expect(construction?.rule).toContain("mark its owner");
    expect(construction?.rule).toContain("also costs one Team");
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
