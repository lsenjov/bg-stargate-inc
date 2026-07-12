import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type {
  ClientToServerEvents,
  CommandResult,
  ServerToClientEvents,
  SessionData,
} from "@stargate-inc/shared";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createGameServer, type GameServer } from "./lobby-server.js";

type TestSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

let clientDistPath: string;
let server: GameServer;
let serverUrl: string;
let socket: TestSocket | undefined;

beforeEach(async () => {
  clientDistPath = await mkdtemp(join(tmpdir(), "stargate-production-"));
  await mkdir(join(clientDistPath, "assets"));
  await writeFile(
    join(clientDistPath, "index.html"),
    "<!doctype html><html><body>Stargate production client</body></html>",
  );
  await writeFile(join(clientDistPath, "assets", "app.js"), "globalThis.app = true;");
  server = createGameServer({ clientDistPath });
  await new Promise<void>((resolve) =>
    server.httpServer.listen(0, "127.0.0.1", resolve),
  );
  const address = server.httpServer.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  socket?.disconnect();
  await new Promise<void>((resolve) => server.io.close(() => resolve()));
  await rm(clientDistPath, { force: true, recursive: true });
});

describe("production HTTP service", () => {
  it("serves health, client assets, SPA fallback, and Socket.IO on one origin", async () => {
    const health = await fetch(`${serverUrl}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: "ok" });

    const root = await fetch(serverUrl);
    expect(root.headers.get("content-type")).toBe("text/html; charset=utf-8");
    await expect(root.text()).resolves.toContain("Stargate production client");

    const spaRoute = await fetch(`${serverUrl}/lobby/ABCDEFGHJK`);
    expect(spaRoute.status).toBe(200);
    await expect(spaRoute.text()).resolves.toContain("Stargate production client");

    const asset = await fetch(`${serverUrl}/assets/app.js`);
    expect(asset.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    await expect(asset.text()).resolves.toBe("globalThis.app = true;");
    expect((await fetch(`${serverUrl}/assets/missing.js`)).status).toBe(404);

    socket = createClient(serverUrl, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    });
    await new Promise<void>((resolve, reject) => {
      socket?.once("connect", resolve);
      socket?.once("connect_error", reject);
    });
    const created = await new Promise<CommandResult<SessionData>>((resolve) =>
      socket?.emit("lobby:create", { name: "Production Host" }, resolve),
    );
    expect(created).toMatchObject({ ok: true });
  });
});
