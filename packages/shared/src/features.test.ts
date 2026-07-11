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
      "secret-simultaneous-selection",
      "played-card-exhaustion",
      "pause-follow-up",
      "mutual-player-connection",
      "exclusive-exoplanet-connection",
      "pause-exoplanet-retry",
      "self-connection-reset",
    ]);
  });

  it("keeps undefined rewards visibly unresolved", () => {
    expect(getFeature("trade-reward")?.status).toBe("unresolved");
    expect(getFeature("internal-production-reward")?.status).toBe("unresolved");
    expect(getFeature("failed-connection-compensation")?.status).toBe(
      "unresolved",
    );
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
