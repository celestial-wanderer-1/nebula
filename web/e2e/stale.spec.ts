import { expect, test } from "./test";
import { TOKEN } from "./helpers";

// A§4.4, D101: a Run whose pinned inputs have newer versions is stale; one
// click re-runs it, unchanged steps from the cache.

test("re-runs a stale run with the latest inputs", async ({ page }) => {
  await page.goto(`/p/p-baseline/runs/r-03${TOKEN}`);
  const state = page.getByRole("group", { name: "Run state" });
  await expect(state.getByText("Stale")).toBeVisible();
  await expect(state).toContainText("Newer:");
  await state
    .getByRole("button", {
      name: "Re-run Field to stability #3 with latest inputs",
    })
    .click();
  await expect(page).toHaveURL(/\/runs\/r-1\d\d$/);
  await expect(state).toContainText("Re-run of r-03");
  await expect(state.getByText("cache hit")).toBeVisible();
  await expect(state.getByText("Stale")).toHaveCount(0);
});
