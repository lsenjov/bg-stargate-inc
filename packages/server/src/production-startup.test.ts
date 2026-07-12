import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { resolveClientDistPath, validateClientDistPath } from "./index.js";

const temporaryPaths: string[] = [];

async function temporaryClientDist(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "stargate-client-dist-"));
  temporaryPaths.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, { force: true, recursive: true })
    ),
  );
});

describe("production startup", () => {
  it("uses CLIENT_DIST_PATH when provided", () => {
    expect(resolveClientDistPath({ CLIENT_DIST_PATH: "./custom-client" }))
      .toBe(resolve("./custom-client"));
  });

  it("accepts a built client with its referenced JavaScript bundle", async () => {
    const clientDistPath = await temporaryClientDist();
    await mkdir(join(clientDistPath, "assets"));
    await writeFile(
      join(clientDistPath, "index.html"),
      '<!doctype html><script type="module" src="/assets/app.js"></script>',
    );
    await writeFile(join(clientDistPath, "assets", "app.js"), "");

    await expect(validateClientDistPath(clientDistPath)).resolves.toBeUndefined();
  });

  it("rejects a missing client index", async () => {
    const clientDistPath = await temporaryClientDist();

    await expect(validateClientDistPath(clientDistPath)).rejects.toThrow(
      /Production client index missing/,
    );
  });

  it("rejects an index whose client bundle is missing", async () => {
    const clientDistPath = await temporaryClientDist();
    await writeFile(
      join(clientDistPath, "index.html"),
      '<!doctype html><script type="module" src="/assets/missing.js"></script>',
    );

    await expect(validateClientDistPath(clientDistPath)).rejects.toThrow(
      /Production client bundle missing/,
    );
  });
});
