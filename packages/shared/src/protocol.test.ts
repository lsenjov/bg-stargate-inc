import { describe, expect, it } from "vitest";

import {
  exoplanetGestureKinds,
  gestureCommandSchema,
  playerGestureKinds,
} from "./protocol.js";

const playerId = "AbCdEfGhIjKlMnOpQrStUv";

describe("gesture protocol", () => {
  it("accepts every gesture allowed for its target type", () => {
    for (const gesture of playerGestureKinds) {
      expect(
        gestureCommandSchema.safeParse({
          target: { kind: "player", playerId },
          gesture,
        }).success,
      ).toBe(true);
    }
    for (const gesture of exoplanetGestureKinds) {
      expect(
        gestureCommandSchema.safeParse({
          target: { kind: "exoplanet", exoplanetId: "alpha" },
          gesture,
        }).success,
      ).toBe(true);
    }
  });

  it("rejects gestures that are not allowed for the target type", () => {
    expect(
      gestureCommandSchema.safeParse({
        target: { kind: "player", playerId },
        gesture: "point",
      }).success,
    ).toBe(false);
    expect(
      gestureCommandSchema.safeParse({
        target: { kind: "exoplanet", exoplanetId: "alpha" },
        gesture: "wave",
      }).success,
    ).toBe(false);
  });

  it.each([
    null,
    {},
    { target: { kind: "player", playerId }, gesture: "nod", extra: true },
    {
      target: { kind: "player", playerId, extra: true },
      gesture: "nod",
    },
    { target: { kind: "player", playerId: "short" }, gesture: "nod" },
    { target: { kind: "exoplanet", exoplanetId: "" }, gesture: "nod" },
    { target: { kind: "unknown", playerId }, gesture: "nod" },
  ])("strictly rejects malformed payload %#", (payload) => {
    expect(gestureCommandSchema.safeParse(payload).success).toBe(false);
  });
});
