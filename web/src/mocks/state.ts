import { MockStore } from "./store";
import { MOCK_API_VERSION } from "./token";

/** The one mock backend instance shared by REST and WebSocket handlers. */
export const store = new MockStore(MOCK_API_VERSION);

export function resetMockStore(): void {
  store.reset(MOCK_API_VERSION);
}
