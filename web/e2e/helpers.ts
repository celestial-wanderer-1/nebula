import { expect, type Page } from "@playwright/test";

// The launch URL `nebula serve` would print; the mock accepts this token.
export const TOKEN = "#token=mock-token";

/** Collects uncaught page errors; every test expects none. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

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
