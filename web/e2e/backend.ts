import type { APIRequestContext, Page } from "@playwright/test";

// What differs between the e2e targets (playwright.config.ts): the token,
// and how tests reach the backend's scripted situations.

export const REAL = process.env.E2E_TARGET === "real";

const TOKEN_VALUE = REAL ? "stub-e2e-token" : "mock-token";

/** The launch URL fragment `nebula serve` would print. */
export const TOKEN = `#token=${TOKEN_VALUE}`;

export const AUTHORIZATION = { Authorization: `Bearer ${TOKEN_VALUE}` };

/** Restores the stub's fixtures; the mock starts fresh with each page. */
export async function resetBackend(request: APIRequestContext): Promise<void> {
  if (!REAL) return;
  const response = await request.post("/__stub/reset", {
    headers: AUTHORIZATION,
  });
  if (!response.ok()) throw new Error(`Reset failed: ${response.status()}`);
}

/** Calls a scripted situation of the backend (src/mocks/scenarios.ts). */
export async function mock<A extends unknown[]>(
  page: Page,
  name: string,
  ...args: A
): Promise<void> {
  if (REAL) {
    const response = await page.request.post("/__stub/scenario", {
      headers: AUTHORIZATION,
      data: { name, args },
    });
    if (!response.ok()) {
      throw new Error(`${name} failed: ${await response.text()}`);
    }
    return;
  }
  // The mock backend starts asynchronously after the page loads.
  await page.waitForFunction(() => window.__nebulaMock !== undefined);
  await page.evaluate(
    ([scenario, rest]) => {
      const scenarios = window.__nebulaMock as unknown as Record<
        string,
        (...a: unknown[]) => void
      >;
      scenarios[scenario as string]!(...(rest as unknown[]));
    },
    [name, args] as const,
  );
}
