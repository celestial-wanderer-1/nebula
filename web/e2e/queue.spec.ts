import { expect, test } from "./test";
import { mock, TOKEN } from "./helpers";

// D102, D142: a FIFO queue shared across projects, reorder and cancel.

test("reorders and cancels waiting runs", async ({ page }) => {
  await page.goto(`/p/p-baseline/workflows/wf-chain${TOKEN}`);
  await mock(page, "setRunMode", "manual");
  for (const [gpus, name] of [
    ["4", "Wide"],
    ["1", "Narrow"],
  ] as const) {
    await page.getByRole("button", { name: "Run…" }).click();
    const dialog = page.getByRole("dialog", { name: "Run workflow" });
    await dialog.getByRole("radio", { name: /^Fast/ }).check();
    await dialog.getByLabel("GPUs").selectOption(gpus);
    await dialog.getByLabel("Run name").fill(name);
    await dialog.getByRole("button", { name: "Submit run" }).click();
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    await page.goBack();
  }
  // Both prepare; Wide needs all 4 GPUs and r-12 holds one: it waits, and
  // Narrow waits behind it (no backfill).
  await mock(page, "advance", 5_000);
  // In-app navigation: a reload would restart the in-browser mock.
  await page
    .getByRole("navigation", { name: "Project" })
    .getByRole("link", { name: "Runs and queue" })
    .click();
  await page.getByRole("tab", { name: "Queue" }).click();
  const queue = page.getByRole("table", { name: "Queue" });
  await expect(queue.getByRole("row")).toHaveCount(4);
  await expect(queue.getByRole("row").nth(1)).toContainText("Wide");
  await expect(queue.getByRole("row").nth(2)).toContainText("Narrow");
  // First in the queue, Narrow fits the free GPUs and starts.
  await queue.getByRole("button", { name: "Move Narrow up" }).click();
  await expect(queue.getByRole("row", { name: /Narrow/ })).toContainText(
    "Running",
  );
  await expect(queue.getByRole("row", { name: /Wide/ })).toContainText(
    "Queued",
  );
  await queue.getByRole("button", { name: "Cancel Wide" }).click();
  await expect(queue.getByRole("row", { name: /Wide/ })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Queue" })).toContainText(
    "0 queued",
  );
});
