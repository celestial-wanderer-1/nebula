import type { Locator, Page } from "@playwright/test";
import { mock, RUN_STATE, runIdOf, TOKEN } from "./helpers";
import { expect, test } from "./test";

// docs/UI.md 6.7: every catalogue viewer renders its fixture payload, and
// parameter changes round-trip through the view channel (A§3.6).

const open = (page: Page, output: string) =>
  page.goto(
    `/p/p-baseline/results/r-14?output=${encodeURIComponent(output)}${TOKEN}`,
  );

const status = (page: Page) =>
  page.getByRole("status", { name: "View status" });

/** A WebGL canvas that drew something: a blank one compresses to little. */
async function expectDrawn(canvas: Locator) {
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () => (await canvas.screenshot()).length, { timeout: 10_000 })
    .toBeGreaterThan(6_000);
}

for (const [output, viewer, title, pieces] of [
  ["t1/equilibrium", "2D contour", "t1 · equilibrium", "psi,contours"],
  ["field/field", "3D field", "field · field", "slice,field lines"],
  ["poincare/poincare", "Poincaré section", "poincare · poincare", "punctures"],
  ["stability/modes", "Mode structure", "stability · modes: m = 2", "mode"],
] as const) {
  test(`renders the ${viewer} viewer with vtk.js`, async ({ page }) => {
    await open(page, output);
    const view = page.getByRole("img", { name: title });
    await expect(view).toHaveAttribute("data-pieces", pieces);
    await expect(page.getByRole("button", { name: viewer })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expectDrawn(view.locator("canvas"));
  });
}

for (const [output, viewer, title] of [
  ["transport/profiles", "1D profile", "transport · profiles"],
  ["stability/growth_rates", "Spectrum", "stability · growth_rates"],
] as const) {
  test(`renders the ${viewer} viewer with Plotly`, async ({ page }) => {
    await open(page, output);
    const chart = page.getByRole("figure", { name: title });
    await expect(chart.locator(".main-svg").first()).toBeVisible();
    await expect(
      chart.locator(".scatterlayer .trace, .barlayer .trace"),
    ).not.toHaveCount(0);
  });
}

test("renders the time trace and slices a time series (D146)", async ({
  page,
}) => {
  await open(page, "transport/profiles");
  await page.getByRole("button", { name: "Time trace" }).click();
  const chart = page.getByRole("figure", { name: "transport · profiles" });
  await expect(chart.locator(".scatterlayer .trace")).toHaveCount(2);
  await page.getByLabel("Time slice").fill("6");
  await expect(page.getByText("t = 3 s (7 of 10")).toBeVisible();
  await expect(status(page)).toHaveText("Up to date");
});

test("round-trips view parameters and serves repeats from the cache", async ({
  page,
}) => {
  await open(page, "t1/equilibrium");
  const view = page.getByRole("img", { name: "t1 · equilibrium" });
  await expect(status(page)).toHaveText("Up to date");
  const before = Number(await view.getAttribute("data-cells"));
  await page.getByLabel("Contour levels").fill("0.3, 0.6");
  await expect(status(page)).toHaveText("Up to date");
  await expect
    .poll(async () => Number(await view.getAttribute("data-cells")))
    .toBeLessThan(before);
  await page.getByLabel("Contour levels").fill("");
  await page.getByLabel("Contour levels").fill("0.3, 0.6");
  await expect(status(page)).toHaveText("From the view cache");
  // An isosurface comes as binary glTF, without external URIs (D117).
  await page.getByRole("link", { name: /Biot–Savart field · field/ }).click();
  await page.getByLabel("Isosurface (ψ_n, empty for a slice)").fill("0.7");
  await expect(page.getByRole("img", { name: /ψ_n = 0.70/ })).toHaveAttribute(
    "data-body",
    "gltf",
  );
});

test("shows outputs of a live run as they commit (D122)", async ({ page }) => {
  await page.goto(`/p/p-baseline/workflows/wf-chain${TOKEN}`);
  await mock(page, "setRunMode", "manual");
  await page.getByRole("button", { name: "Run…" }).click();
  const dialog = page.getByRole("dialog", { name: "Run workflow" });
  await dialog.getByRole("radio", { name: /^Fast/ }).check();
  await expect(dialog.getByText("No step is cached.")).toBeVisible();
  await dialog.getByRole("button", { name: "Submit run" }).click();
  const id = await runIdOf(page);
  await mock(page, "runUntil", id, RUN_STATE.RUNNING);
  await page
    .getByRole("navigation", { name: "Project" })
    .getByRole("link", { name: "Results" })
    .click();
  await page.getByRole("link", { name: "Field to stability #13" }).click();
  const list = page.getByRole("table", { name: "Outputs" });
  await expect(page.getByText("No outputs committed yet.")).toBeVisible();
  // The field step finishes: its outputs appear and can be viewed at once.
  await mock(page, "advance", 2_000);
  await expect(list.getByRole("row")).toHaveCount(3);
  await list.getByRole("link", { name: /Biot–Savart field · field/ }).click();
  await expect(
    page.getByRole("img", { name: "field · field" }),
  ).toHaveAttribute("data-pieces", "B,contours");
});
