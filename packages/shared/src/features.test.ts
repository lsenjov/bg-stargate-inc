import { describe, expect, it } from "vitest";

import { gameFeatures, getFeature, playableFeatureIds } from "./features.js";

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
});
