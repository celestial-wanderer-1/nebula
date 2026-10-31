import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { mock, RUN_STATE, runIdOf, TOKEN } from "./helpers";

// A§3.7: typed failures, resume from a checkpoint for transient reasons,
// re-run with an edited workflow otherwise; pause and resume. The mock
// runs on a manual clock here, so intermediate states hold still.

const actions = (page: Page) =>
  page.getByRole("group", { name: "Run actions" });
/** Clicks a Run action and waits until the server has applied it. */
async function act(page: Page, name: string) {
  const applied = page.waitForResponse(
    (response) => response.url().endsWith("/actions") && response.ok(),
  );
  await actions(page).getByRole("button", { name }).click();
  await applied;
}

const badge = (page: Page) =>
  page.getByRole("group", { name: "Run state" }).locator(".badge").first();

/** Submits wf-chain in fast mode, which nothing has cached, with a script. */
async function submit(page: Page, script: string) {
  await page.goto(`/p/p-baseline/workflows/wf-chain${TOKEN}`);
  await mock(page, "setRunMode", "manual");
  await mock(page, "scriptNextRun", script);
  await page.getByRole("button", { name: "Run…" }).click();
  const dialog = page.getByRole("dialog", { name: /Run workflow|Re-run/ });
  await dialog.getByRole("radio", { name: /^Fast/ }).check();
  await expect(
    dialog.getByRole("region", { name: "Submission summary" }),
  ).toContainText("No step is cached.");
  await dialog.getByRole("button", { name: "Submit run" }).click();
  await expect(badge(page)).toHaveText("Queued");
  return await runIdOf(page);
}

for (const [script, reason] of [
  ["oom", "oom"],
  ["supervisor_lost", "supervisor_lost"],
] as const) {
  test(`resumes after ${reason} from the last checkpoint`, async ({ page }) => {
    const id = await submit(page, script);
    await mock(page, "runUntil", id, RUN_STATE.FAILED);
    await expect(badge(page)).toHaveText("Failed");
    await expect(page.getByRole("alert").first()).toContainText(
      `Attempt 1 failed (${reason})`,
    );
    await expect(page.getByRole("alert").first()).toContainText("is committed");
    await act(page, "Resume");
    await mock(page, "runUntil", id, RUN_STATE.COMPLETED);
    await expect(badge(page)).toHaveText("Completed");
    const attempts = page.getByRole("region", { name: "Attempts" });
    await expect(attempts.getByRole("row")).toHaveCount(3);
  });
}

test("re-runs a diverged run with an edited workflow", async ({ page }) => {
  const id = await submit(page, "diverged");
  await mock(page, "runUntil", id, RUN_STATE.FAILED);
  await expect(badge(page)).toHaveText("Failed");
  await expect(
    actions(page).getByRole("button", { name: "Resume" }),
  ).toBeDisabled();
  await actions(page)
    .getByRole("button", { name: "Re-run with edited workflow" })
    .click();
  const banner = page.getByRole("region", { name: "Re-run" });
  await banner
    .getByRole("button", { name: "Load its workflow into the draft" })
    .click();
  await expect(banner).toContainText("Its workflow version is in the draft");
  // The edit: a different T1 rank count is no use here; relabel a step.
  await page
    .getByRole("region", { name: "Nodes" })
    .getByRole("button", { name: "T1 equilibrium" })
    .click();
  await page.getByLabel("Node label").fill("T1 equilibrium (tighter)");
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "Saved",
  );
  await page.getByRole("button", { name: "Run…" }).click();
  const dialog = page.getByRole("dialog", { name: `Re-run ${id}` });
  await dialog.getByRole("radio", { name: /^Fast/ }).check();
  await dialog.getByRole("button", { name: "Submit run" }).click();
  await expect(page.getByRole("group", { name: "Run state" })).toContainText(
    `Re-run of ${id}`,
  );
  const second = await runIdOf(page);
  await mock(page, "runUntil", second, RUN_STATE.COMPLETED);
  await expect(badge(page)).toHaveText("Completed");
});

test("pauses a running run and resumes it", async ({ page }) => {
  const id = await submit(page, "success");
  await mock(page, "runUntil", id, RUN_STATE.RUNNING);
  await expect(badge(page)).toHaveText("Running");
  await act(page, "Pause");
  await mock(page, "runUntil", id, RUN_STATE.PAUSED);
  await expect(badge(page)).toHaveText("Paused");
  await expect(
    actions(page).getByRole("button", { name: "Pause" }),
  ).toBeDisabled();
  await act(page, "Resume");
  await mock(page, "runUntil", id, RUN_STATE.COMPLETED);
  await expect(badge(page)).toHaveText("Completed");
});
