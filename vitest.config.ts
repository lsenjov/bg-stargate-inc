import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["packages/shared/src/**/*.ts"],
    },
    include: ["packages/**/src/**/*.test.ts"],
  },
});
