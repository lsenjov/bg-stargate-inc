import { describe, expect, it } from "vitest";

import {
  exoplanetGestureKinds,
  factoryConstructionCommandSchema,
  factoryRunCommandSchema,
  gestureCommandSchema,
  playerGestureKinds,
  selectionUndoCommandSchema,
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

describe("factory command protocol", () => {
  it("accepts each strict construction target", () => {
    for (const target of [
      { kind: "new-factory" },
      { kind: "factory", factoryId: "factory-1" },
      { kind: "exoplanet-slot", slotIndex: 2 },
    ]) {
      expect(
        factoryConstructionCommandSchema.safeParse({
          moduleId: "module-1",
          target,
        }).success,
      ).toBe(true);
    }
  });

  it.each([
    null,
    {},
    { moduleId: "", target: { kind: "new-factory" } },
    { moduleId: "module-1", target: { kind: "factory" } },
    {
      moduleId: "module-1",
      target: { kind: "exoplanet-slot", slotIndex: 3 },
    },
    {
      moduleId: "module-1",
      target: { kind: "new-factory", extra: true },
    },
    {
      moduleId: "module-1",
      target: { kind: "new-factory" },
      extra: true,
    },
  ])("rejects malformed construction payload %#", (payload) => {
    expect(factoryConstructionCommandSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("accepts only a strict factory run command", () => {
    expect(factoryRunCommandSchema.safeParse({ factoryId: "factory-1" }).success)
      .toBe(true);
    for (const payload of [
      null,
      {},
      { factoryId: "" },
      { factoryId: "factory-1", extra: true },
    ]) {
      expect(factoryRunCommandSchema.safeParse(payload).success).toBe(false);
    }
  });
});

describe("selection undo protocol", () => {
  it("accepts only a strict empty command", () => {
    expect(selectionUndoCommandSchema.safeParse({}).success).toBe(true);

    for (const payload of [null, [], "undo", { cardId: "card" }, { extra: true }]) {
      expect(selectionUndoCommandSchema.safeParse(payload).success).toBe(false);
    }
  });
});
