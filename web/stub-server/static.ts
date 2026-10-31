import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { NONCE_PLACEHOLDER, newNonce, securityHeaders } from "./security";

// Serves the production bundle (docs/UI.md Section 8): hashed assets are
// immutable, index.html is revalidated and carries a fresh nonce, and
// browser routes fall back to index.html. API, WebSocket and control paths
// never do, so a mistyped API call fails as JSON rather than as HTML.

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

export interface StaticSite {
  serve(request: IncomingMessage, response: ServerResponse): Promise<void>;
}

/** Whether a path is a client-side route of the single-page app. */
function isBrowserRoute(pathname: string): boolean {
  const last = pathname.split("/").pop() ?? "";
  return !pathname.startsWith("/assets/") && !last.includes(".");
}

export function staticSite(root: string): StaticSite {
  const resolve = (pathname: string): string | undefined => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return undefined;
    }
    const file = normalize(join(root, decoded));
    return file === root || file.startsWith(root + sep) ? file : undefined;
  };

  const sendIndex = async (
    request: IncomingMessage,
    response: ServerResponse,
    host: string,
  ) => {
    const nonce = newNonce();
    const html = (await readFile(join(root, "index.html"), "utf8")).replaceAll(
      NONCE_PLACEHOLDER,
      nonce,
    );
    response.writeHead(200, {
      ...securityHeaders(host, nonce),
      "Content-Type": TYPES[".html"],
      "Cache-Control": "no-cache",
    });
    response.end(request.method === "HEAD" ? undefined : html);
  };

  return {
    async serve(request, response) {
      const host = request.headers.host ?? "";
      const { pathname } = new URL(request.url ?? "/", `http://${host}`);
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, {
          ...securityHeaders(host),
          Allow: "GET, HEAD",
        });
        response.end();
        return;
      }
      if (pathname === "/" || pathname === "/index.html") {
        return sendIndex(request, response, host);
      }
      const file = resolve(pathname);
      const info = file ? await stat(file).catch(() => undefined) : undefined;
      if (file && info?.isFile()) {
        response.writeHead(200, {
          ...securityHeaders(host),
          "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
          "Content-Length": info.size,
          "Cache-Control": pathname.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        });
        response.end(
          request.method === "HEAD" ? undefined : await readFile(file),
        );
        return;
      }
      if (isBrowserRoute(pathname)) return sendIndex(request, response, host);
      response.writeHead(404, {
        ...securityHeaders(host),
        "Content-Type": TYPES[".txt"],
      });
      response.end("Not found");
    },
  };
}
