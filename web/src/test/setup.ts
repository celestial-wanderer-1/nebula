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

afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetMockStore();
  setTokenForTesting(undefined);
  setTypeRegistry(coreRegistry);
});

afterAll(() => server.close());
