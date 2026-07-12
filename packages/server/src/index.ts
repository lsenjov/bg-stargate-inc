import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { playableFeatureIds } from "@stargate-inc/shared";

import { createGameServer } from "./lobby-server.js";

export { createGameServer } from "./lobby-server.js";
export type { GameServer, GameServerOptions } from "./lobby-server.js";

export const serverFoundation = {
  authority: "server" as const,
  playableFeatureIds,
};

export function resolveClientDistPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(env.CLIENT_DIST_PATH ?? fileURLToPath(
    new URL("../../client/dist", import.meta.url),
  ));
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function validateClientDistPath(clientDistPath: string): Promise<void> {
  const staticRoot = resolve(clientDistPath);
  const indexPath = resolve(staticRoot, "index.html");
  let indexHtml: string;
  try {
    indexHtml = await readFile(indexPath, "utf8");
  } catch {
    throw new Error(
      `Production client index missing at ${indexPath}. Run npm run build or set CLIENT_DIST_PATH to a complete client build.`,
    );
  }

  const localScripts = [...indexHtml.matchAll(
    /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,
  )]
    .map((match) => new URL(match[1]!, "http://localhost"))
    .filter((url) => url.origin === "http://localhost");
  if (localScripts.length === 0) {
    throw new Error(
      `Production client bundle missing: ${indexPath} does not reference a local script. Run npm run build or set CLIENT_DIST_PATH to a complete client build.`,
    );
  }

  for (const scriptUrl of localScripts) {
    const scriptPath = resolve(
      staticRoot,
      `.${decodeURIComponent(scriptUrl.pathname)}`,
    );
    const contained = scriptPath.startsWith(`${staticRoot}${sep}`);
    if (!contained || !await isRegularFile(scriptPath)) {
      throw new Error(
        `Production client bundle missing at ${scriptPath}. Run npm run build or set CLIENT_DIST_PATH to a complete client build.`,
      );
    }
  }
}

export async function startProductionServer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const port = Number.parseInt(env.PORT ?? "3001", 10);
  const clientDistPath = resolveClientDistPath(env);
  await validateClientDistPath(clientDistPath);
  const { httpServer } = createGameServer({
    corsOrigin: env.CLIENT_ORIGIN ?? "http://localhost:5173",
    clientDistPath,
  });
  await new Promise<void>((resolveListen, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, () => {
      httpServer.off("error", reject);
      resolveListen();
    });
  });
  process.stdout.write(`Stargate Inc server listening on port ${port}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startProductionServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Stargate Inc server failed to start: ${message}\n`);
    process.exitCode = 1;
  });
}
