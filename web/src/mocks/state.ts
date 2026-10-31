import { MockClock } from "./clock";
import { MockStore } from "./store";
import { MOCK_API_VERSION } from "./token";

/**
 * The one mock backend instance shared by REST and WebSocket handlers.
 * Unit tests drive its scripted Runs with a manual clock.
 */
export const store = new MockStore(
  MOCK_API_VERSION,
  new MockClock({ mode: import.meta.env.MODE === "test" ? "manual" : "auto" }),
);

export function resetMockStore(): void {
  store.reset(MOCK_API_VERSION);
}
