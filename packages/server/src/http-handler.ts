import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function send(
  response: ServerResponse,
  statusCode: number,
  body: string | Buffer,
  headers: Readonly<Record<string, string>>,
  headOnly: boolean,
): void {
  response.writeHead(statusCode, {
    "content-length": Buffer.byteLength(body).toString(),
    ...headers,
  });
  response.end(headOnly ? undefined : body);
}

async function regularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function createHttpHandler(
  clientDistPath?: string,
): (request: IncomingMessage, response: ServerResponse) => void {
  const staticRoot = clientDistPath ? resolve(clientDistPath) : undefined;

  return (request, response) => {
    void (async () => {
      const headOnly = request.method === "HEAD";
      if (request.method !== "GET" && !headOnly) {
        send(
          response,
          405,
          "Method Not Allowed",
          { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" },
          false,
        );
        return;
      }

      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/health") {
        send(
          response,
          200,
          JSON.stringify({ status: "ok" }),
          {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          },
          headOnly,
        );
        return;
      }

      if (!staticRoot) {
        send(
          response,
          404,
          "Not Found",
          { "content-type": "text/plain; charset=utf-8" },
          headOnly,
        );
        return;
      }

      let pathname: string;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        send(
          response,
          400,
          "Bad Request",
          { "content-type": "text/plain; charset=utf-8" },
          headOnly,
        );
        return;
      }

      const requestedPath = resolve(staticRoot, `.${pathname}`);
      const contained =
        requestedPath === staticRoot || requestedPath.startsWith(`${staticRoot}${sep}`);
      const assetPath = contained && await regularFile(requestedPath)
        ? requestedPath
        : undefined;
      const hasFileExtension = extname(pathname) !== "";
      const filePath = assetPath ?? (hasFileExtension
        ? undefined
        : resolve(staticRoot, "index.html"));

      if (!filePath || !await regularFile(filePath)) {
        send(
          response,
          404,
          "Not Found",
          { "content-type": "text/plain; charset=utf-8" },
          headOnly,
        );
        return;
      }

      const body = await readFile(filePath);
      const isIndex = filePath === resolve(staticRoot, "index.html");
      send(
        response,
        200,
        body,
        {
          "cache-control": isIndex || !pathname.startsWith("/assets/")
            ? "no-cache"
            : "public, max-age=31536000, immutable",
          "content-type": contentTypes[extname(filePath).toLowerCase()] ??
            "application/octet-stream",
        },
        headOnly,
      );
    })().catch(() => {
      if (!response.headersSent) {
        send(
          response,
          500,
          "Internal Server Error",
          { "content-type": "text/plain; charset=utf-8" },
          request.method === "HEAD",
        );
      } else {
        response.destroy();
      }
    });
  };
}
