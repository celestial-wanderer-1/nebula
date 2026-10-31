import { expect, type Page } from "@playwright/test";

// The launch URL `nebula serve` would print; the mock accepts this token.
export const TOKEN = "#token=mock-token";

export async function createProject(
  page: Page,
  template: string,
  name: string,
) {
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Template").selectOption({ label: template });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(
    page.getByRole("main").getByRole("heading", { name, level: 1 }),
  ).toBeVisible();
}

// RunState values; e2e tests do not import the generated code.
export const RUN_STATE = {
  QUEUED: 1,
  PREPARING: 2,
  RUNNING: 3,
  PAUSED: 4,
  COMPLETED: 5,
  FAILED: 6,
  CANCELLED: 7,
} as const;

/** Calls a scripted situation of the mock backend (src/mocks/scenarios.ts). */
export async function mock<A extends unknown[]>(
  page: Page,
  name: string,
  ...args: A
): Promise<void> {
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

/** The ID of the Run whose page opens after a submission. */
export async function runIdOf(page: Page): Promise<string> {
  await page.waitForURL(/\/runs\/r-\d+$/);
  return page.url().split("/").pop()!;
}
