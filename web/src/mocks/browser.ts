import { setupWorker } from "msw/browser";
import { restHandlers } from "./handlers";
import { applyNamedScenario, scenarios } from "./scenarios";
import { wsHandlers } from "./ws";

declare global {
  interface Window {
    /** Mock controls for Playwright and manual checks (mock builds only). */
    __nebulaMock?: typeof scenarios;
  }
}

/**
 * Starts the mock backend in the browser. The scenario comes from the URL
 * fragment (`#token=...&scenario=version-mismatch`), read before the token
 * bootstrap scrubs the fragment.
 */
export async function startMockBackend(): Promise<void> {
  applyNamedScenario(
    new URLSearchParams(window.location.hash.slice(1)).get("scenario"),
  );
  window.__nebulaMock = scenarios;
  await setupWorker(...restHandlers, ...wsHandlers).start({
    onUnhandledRequest: "bypass",
    quiet: true,
  });
}
