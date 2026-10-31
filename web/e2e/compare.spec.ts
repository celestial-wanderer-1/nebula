import { TOKEN } from "./helpers";
import { expect, test } from "./test";

// docs/UI.md 6.8: two fixture Runs compare in all four views and
// out-of-tolerance quantities are flagged (D43, D104).

test("compares two runs in all four views", async ({ page }) => {
  await page.goto(`/p/p-baseline/comparison${TOKEN}`);
  const form = page.getByRole("form", { name: "New comparison" });
  await form.getByRole("checkbox", { name: /Field to stability #11/ }).check();
  await form.getByRole("checkbox", { name: /Field to stability #3/ }).check();
  await form
    .getByRole("group", { name: "Shared region" })
    .getByLabel("Region", { exact: true })
    .selectOption({ label: "Poloidal plane" });
  await form.getByRole("button", { name: "Compare 2 runs" }).click();

  // Scalars, flagged against tolerances.
  await expect(
    page.getByRole("status", { name: "Comparison summary" }),
  ).toHaveText("1 quantity differs beyond tolerance.");
  const q95 = page.getByRole("row", { name: /q95/ });
  await expect(q95).toContainText("Out of tolerance");
  await expect(page.getByRole("row", { name: /Plasma current/ })).toContainText(
    "Within tolerance",
  );

  // Overlaid profiles.
  await page.getByRole("tab", { name: "Profiles" }).click();
  const chart = page.getByRole("img", {
    name: "Profiles of t1/equilibrium across runs",
  });
  await expect(chart.locator(".scatterlayer .trace")).toHaveCount(4);
  await expect(chart.locator(".legendtext")).toContainText([
    "q · Field to stability #11",
    "p / p0 · Field to stability #11",
    "q · Field to stability #3",
    "p / p0 · Field to stability #3",
  ]);

  // The difference field, resampled on the shared region.
  await page.getByRole("tab", { name: "Difference" }).click();
  const difference = page.getByRole("img", {
    name: /r-11 − r-03: field · field/,
  });
  await expect(difference).toHaveAttribute("data-scalars", "Δ|B|");
  await expect(difference.locator("canvas")).toBeVisible();

  // Linked 3D views.
  await page.getByRole("tab", { name: "Linked 3D" }).click();
  await page
    .getByLabel("Output")
    .selectOption({ label: "t1/lcfs (Surface.Boundary)" });
  const linked = page.locator(".linked-views");
  await expect(linked.getByRole("img")).toHaveCount(2);
  await expect(linked.locator("canvas")).toHaveCount(2);
});
