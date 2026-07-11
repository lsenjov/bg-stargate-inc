import { pathToFileURL } from "node:url";

import { playableFeatureIds } from "@stargate-inc/shared";

import { createGameServer } from "./lobby-server.js";

export { createGameServer } from "./lobby-server.js";
export type { GameServer, GameServerOptions } from "./lobby-server.js";

export const serverFoundation = {
  authority: "server" as const,
  playableFeatureIds,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT ?? "3001", 10);
  const { httpServer } = createGameServer({
    corsOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  });
  httpServer.listen(port, () => {
    process.stdout.write(`Stargate Inc server listening on port ${port}\n`);
  });
}
