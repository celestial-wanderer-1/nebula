import { expect, test, type Page } from "@playwright/test";
import { createProject, mock, TOKEN, trackErrors } from "./helpers";

// A§3.4 and A§3.5: submit, mint, queue, prepare, run with live progress,
// commit outputs and complete; an unchanged resubmission is a cache hit.

async function openDefaultWorkflow(page: Page) {
  await page
    .getByRole("navigation", { name: "Project" })
    .getByRole("link", { name: "Workflows" })
    .click();
  await page.getByRole("link", { name: "Concept default" }).click();
  await expect(
    page.getByRole("heading", { name: "Concept default", level: 1 }),
  ).toBeVisible();
}

test("submits a run that mints its drafts and completes with live progress", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto(`/${TOKEN}`);
  await mock(page, "setTiming", 0.2);
  await createProject(page, "Tokamak starter", "E2E runs");
  await openDefaultWorkflow(page);

  await page.getByRole("button", { name: "Run…" }).click();
  const dialog = page.getByRole("dialog", { name: "Run workflow" });
  const summary = dialog.getByRole("region", { name: "Submission summary" });
  await expect(summary).toContainText("No step is cached.");
  const minted = dialog.getByRole("list", { name: "Drafts to mint" });
  await expect(minted).toContainText("Geometry “Reference assembly”");
  await expect(minted).toContainText("Scenario “Flat-top”");
  await expect(minted).toContainText("Workflow “Concept default”");
  // Global stability's manifest hints 2 GPUs (D102).
  await expect(dialog.getByLabel("GPUs")).toHaveValue("2");
  await dialog.getByRole("button", { name: "Submit run" }).click();

  const state = page.getByRole("group", { name: "Run state" });
  await expect(state.locator(".badge").first()).toHaveText(
    /Queued|Preparing|Running/,
  );
  await expect(state.locator(".badge").first()).toHaveText("Completed", {
    timeout: 20_000,
  });
  await expect(page.getByRole("list", { name: "Log lines" })).toContainText(
    "Run completed",
  );
  await expect(
    page.getByRole("img", { name: "Convergence residuals" }),
  ).toBeVisible();
  const outputs = page.getByRole("region", { name: "Outputs" });
  await expect(outputs).toContainText("Global stability · modes");
  const steps = page.getByRole("region", { name: "Steps" });
  await expect(steps.locator("[data-state=COMPLETED]")).toHaveCount(4);

  // The geometry now has a version minted by this run.
  const runId = page.url().split("/").pop()!;
  await page
    .getByRole("navigation", { name: "Project" })
    .getByRole("link", { name: "Geometry" })
    .click();
  await page.getByRole("link", { name: "Reference assembly" }).click();
  await page.getByRole("button", { name: "Versions" }).click();
  await expect(page.getByRole("link", { name: runId })).toBeVisible();

  // Nothing changed: resubmitting is a full cache hit (A§3.4).
  await openDefaultWorkflow(page);
  await page.getByRole("button", { name: "Run…" }).click();
  await expect(
    page.getByRole("region", { name: "Submission summary" }),
  ).toContainText("All 4 steps are cached");
  await page.getByRole("button", { name: "Submit run" }).click();
  await expect(state.getByText("cache hit")).toBeVisible();
  await expect(state.locator(".badge").first()).toHaveText("Completed");
  await expect(steps).toContainText(`Cached from ${runId}`);
  expect(errors).toEqual([]);
});
