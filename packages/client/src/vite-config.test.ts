import { describe, expect, it } from "vitest";

import viteConfig, {
  defaultDevServerUrl,
  devServerUrl,
} from "../vite.config.js";

describe("development proxy", () => {
  it("forwards Socket.IO to the server's default port", () => {
    expect(defaultDevServerUrl).toBe("http://localhost:3001");
    expect(devServerUrl({})).toBe("http://localhost:3001");
    expect(viteConfig).toMatchObject({
      server: {
        proxy: {
          "/socket.io": {
            target: devServerUrl(),
            ws: true,
          },
        },
      },
    });
  });
});
