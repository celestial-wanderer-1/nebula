import { fileURLToPath } from "node:url";
import { expect, test } from "./test";
import { REAL } from "./backend";
import { createProject, mock, TOKEN } from "./helpers";

const foreignExport = fileURLToPath(
  new URL("./fixtures/foreign-build.nebula", import.meta.url),
);

test("asks for the launch URL when opened without a token", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Nebula");
  await expect(
    page.getByRole("heading", { name: "Open Nebula from its launch URL" }),
  ).toBeVisible();
});

test("refuses an incompatible server", async ({ page }) => {
  // The mock bundle reads the scenario from the fragment; the stub is told.
  if (REAL) await mock(page, "versionMismatch");
  await page.goto(`/${TOKEN}&scenario=version-mismatch`);
  await expect(
    page.getByRole("heading", { name: "Incompatible server" }),
  ).toBeVisible();
  await expect(page.getByText("0.0.0-mock (mock-build-1)")).toBeVisible();
});

test("creates a project from each reference concept kit and reopens it", async ({
  page,
}) => {
  await page.goto(`/${TOKEN}`);
  for (const kit of ["Tokamak", "Simple mirror", "Stellarator"]) {
    await createProject(page, `${kit} starter`, `E2E ${kit}`);
    await expect(page.getByText(`${kit} 1.0.0`)).toBeVisible();
    await page.getByRole("link", { name: "Nebula" }).click();
    await expect(page.getByRole("link", { name: `E2E ${kit}` })).toBeVisible();
  }
  await page.getByRole("link", { name: "E2E Simple mirror" }).click();
  await expect(
    page.getByRole("heading", { name: "E2E Simple mirror", level: 1 }),
  ).toBeVisible();

  await page.getByRole("button", { name: /^Switch project/ }).click();
  await page.getByRole("menuitem", { name: "E2E Stellarator" }).click();
  await expect(
    page.getByRole("heading", { name: "E2E Stellarator", level: 1 }),
  ).toBeVisible();
});

test("exports a project and imports it back", async ({ page }, testInfo) => {
  await page.goto(`/${TOKEN}`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Tokamak baseline" }).click();
  const file = testInfo.outputPath("baseline.nebula");
  await (await download).saveAs(file);
  expect((await download).suggestedFilename()).toBe("Tokamak-baseline.nebula");

  await page.getByRole("button", { name: "Import" }).click();
  const dialog = page.getByRole("dialog", { name: "Import project" });
  await dialog.getByLabel("Project export").setInputFiles(file);
  await dialog.getByRole("button", { name: "Import" }).click();
  await expect(dialog.getByText("Imported “Tokamak baseline”.")).toBeVisible();
  await expect(dialog.getByRole("list", { name: "Import issues" })).toHaveCount(
    0,
  );
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(
    page.getByRole("link", { name: "Tokamak baseline" }),
  ).toHaveCount(2);
});

test("marks runs of an import from another build as not reproducible", async ({
  page,
}) => {
  await page.goto(`/${TOKEN}`);
  await page.getByRole("button", { name: "Import" }).click();
  const dialog = page.getByRole("dialog", { name: "Import project" });
  await dialog.getByLabel("Project export").setInputFiles(foreignExport);
  await dialog.getByRole("button", { name: "Import" }).click();
  await expect(
    dialog.getByRole("list", { name: "Import issues" }),
  ).toContainText("6 runs are viewable, not reproducible here");
  await dialog.getByRole("button", { name: "Close" }).click();

  const row = page.getByRole("row").filter({ hasText: "Mirror from lab B" });
  await expect(row.getByText("viewable, not reproducible here")).toBeVisible();

  // Reproducibility is judged per Run (D149): each imported Run says so.
  await page.getByRole("link", { name: "Mirror from lab B" }).click();
  await page
    .getByRole("navigation", { name: "Project" })
    .getByRole("link", { name: "Runs and queue" })
    .click();
  const runs = page.getByRole("table", { name: "Runs" });
  for (const name of ["Lab B field map", "Lab B field lines"]) {
    await expect(
      runs
        .getByRole("row")
        .filter({ hasText: name })
        .getByText("viewable, not reproducible here"),
    ).toBeVisible();
  }
});

test("opens direct project URLs, scrubs the token and needs it again after reload", async ({
  page,
}) => {
  await page.goto(`/p/p-baseline/workflows${TOKEN}`);
  await expect(page.getByRole("heading", { name: "Workflows" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Field to stability" }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  expect(new URL(page.url()).pathname).toBe("/p/p-baseline/workflows");

  const queue = page.getByRole("status", { name: "Queue" });
  await expect(queue).toContainText("1 running");
  await expect(queue).toContainText("GPUs 1/4");

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Open Nebula from its launch URL" }),
  ).toBeVisible();
});
