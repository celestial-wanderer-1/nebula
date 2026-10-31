import react from "@vitejs/plugin-react";
import type { ProxyOptions, Plugin } from "vite";
import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

// Token the mock backend accepts (src/mocks/token.ts).
const MOCK_TOKEN = "mock-token";

// Paths the FastAPI server owns (A§13.2); everything else is the UI bundle.
const API_PREFIXES = [
  "/version",
  "/projects",
  "/templates",
  "/plugins",
  "/queue",
  "/settings",
  "/library",
];

// Prints the mock launch URL the way `nebula serve` prints the real one (D137).
function printMockUrl(): Plugin {
  return {
    name: "nebula-mock-url",
    configureServer(server) {
      const printUrls = server.printUrls.bind(server);
      server.printUrls = () => {
        printUrls();
        const url = server.resolvedUrls?.local[0];
        if (url) {
          server.config.logger.info(`  ➜  Mock UI: ${url}#token=${MOCK_TOKEN}`);
        }
      };
    },
  };
}

// A down server answers 502, which the UI reports as unreachable.
function proxyTo(target: string): ProxyOptions {
  return {
    target,
    configure: (proxy) =>
      proxy.on("error", (_error, _request, response) => {
        if ("writeHead" in response && !response.headersSent) {
          response.writeHead(502).end();
        }
      }),
  };
}

// The production Content Security Policy (D117), applied to mock previews
// too, so a library that needs `eval` or inline styles fails in e2e early.
// Style elements need the page's nonce (index.html); Plotly's one empty
// <style>, filled through the CSSOM, is admitted by the hash of "". The
// preview's nonce is the placeholder: a real server sends a fresh one.
const EMPTY_STYLE_HASH =
  "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  `style-src 'self' 'nonce-NEBULA_CSP_NONCE' ${EMPTY_STYLE_HASH}`,
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

export default defineConfig(({ mode }) => {
  // `pnpm dev` uses the mock unless NEBULA_SERVER points at `nebula serve`
  // (docs/UI.md Section 7); `build:mock` bundles the mock for Playwright.
  const target = process.env.NEBULA_SERVER;
  const useMock =
    mode === "mock" || mode === "test" || (mode === "development" && !target);
  return {
    plugins: [react(), ...(useMock ? [printMockUrl()] : [])],
    // public/ holds only the MSW worker; production bundles must not ship it.
    publicDir: useMock ? "public" : false,
    define: {
      __NEBULA_MOCK__: JSON.stringify(useMock),
      __NEBULA_BUILD__: JSON.stringify(`${pkg.version}+${mode}`),
    },
    preview: {
      headers: {
        "Content-Security-Policy": CSP,
        "X-Content-Type-Options": "nosniff",
      },
    },
    server: target
      ? {
          proxy: {
            ...Object.fromEntries(
              API_PREFIXES.map((p) => [p, proxyTo(target)]),
            ),
            "/ws": { ...proxyTo(target), ws: true },
          },
        }
      : undefined,
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      clearMocks: true,
    },
  };
});
