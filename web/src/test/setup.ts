import "@testing-library/jest-dom/vitest";
import { transferableAbortController } from "node:util";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { setTypeRegistry } from "../api/registry";
import { setTokenForTesting } from "../api/token";
import { server } from "../mocks/node";
import { resetMockStore } from "../mocks/state";
import { coreRegistry } from "../schema/core";

// Node's fetch rejects jsdom's AbortSignal, which TanStack Query passes to
// every request. Use Node's classes, reached through a Node-made controller.
const nodeController = transferableAbortController();
globalThis.AbortController =
  nodeController.constructor as typeof AbortController;
globalThis.AbortSignal = nodeController.signal
  .constructor as typeof AbortSignal;

// Every test runs against the mock backend (docs/UI.md Section 7); a request
// no handler covers is a test bug.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

// Requests the mock backend is still handling. An editor flushes its unsaved
// edit when it unmounts (useDraft); that save must land before the store is
// reset, or it would write into the next test's fresh state.
// A handler has run by "request:match"; a request aborted meanwhile never
// reaches "request:end".
const handling = new Set<string>();
server.events.on("request:start", ({ requestId }) => handling.add(requestId));
for (const event of [
  "request:match",
  "request:end",
  "unhandledException",
] as const) {
  server.events.on(event, ({ requestId }) => handling.delete(requestId));
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until the mock backend has been idle for two checks in a row: a
 * finished save can start a chained one (an edit made during it).
 */
async function drainRequests(limitMs = 2000) {
  const until = Date.now() + limitMs;
  let quiet = 0;
  while (quiet < 2 && Date.now() < until) {
    await tick(10);
    quiet = handling.size === 0 ? quiet + 1 : 0;
  }
}

afterEach(async () => {
  cleanup();
  await drainRequests();
  handling.clear();
  server.resetHandlers();
  resetMockStore();
  setTokenForTesting(undefined);
  setTypeRegistry(coreRegistry);
});

afterAll(() => server.close());
