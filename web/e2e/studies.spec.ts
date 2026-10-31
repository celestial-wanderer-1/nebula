import { mock, TOKEN } from "./helpers";
import { expect, test } from "./test";

// docs/UI.md 6.9: a 2-variable scan over a field workflow shows all point
// Runs progressing in the queue and a filled table (D109, D142).

test("runs a two-variable scan through the queue", async ({ page }) => {
  await page.goto(`/p/p-baseline/studies${TOKEN}`);
  await mock(page, "setTiming", 0.1);
  await page.getByRole("link", { name: "New parameter scan" }).click();
  await page.getByLabel("Name").fill("PF and CS scan");
  await page
    .getByLabel("Base workflow")
    .selectOption({ label: "Field to stability" });
  await page.getByRole("checkbox", { name: /Current of PF/ }).check();
  await page
    .getByRole("checkbox", { name: /Plasma targets: Plasma current/ })
    .check();
  await expect(page.getByText("9 points")).toBeVisible();
  await page.getByRole("button", { name: "Create scan" }).click();

  await expect(
    page.getByRole("heading", { name: "PF and CS scan", level: 1 }),
  ).toBeVisible();
  const points = page.getByRole("table", { name: "Points" });
  await expect(points.getByRole("row")).toHaveCount(10);
  await page.getByRole("button", { name: "Start" }).click();
  const progress = page.getByRole("status", { name: "Study progress" });
  // At most the GPU count run at once (D142); the queue shows them.
  await expect(progress).toContainText("active (at most 4)");
  await expect(page.getByRole("status", { name: "Queue" })).not.toContainText(
    "0 queued",
  );
  await expect(progress).toContainText("Completed: 9 of 9 points completed", {
    timeout: 30_000,
  });
  for (let row = 1; row <= 9; row++) {
    await expect(points.getByRole("row").nth(row)).toContainText("Completed");
  }
  await expect(points.getByRole("row").nth(1).getByRole("link")).toBeVisible();
});
