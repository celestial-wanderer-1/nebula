import type { Page } from "@playwright/test";
import { mock, TOKEN } from "./helpers";
import { expect, test } from "./test";

// Performance on large meshes and payloads (docs/UI.md P7, D161): times
// from src/perf.ts spans, reported as annotations and on stdout. The bounds
// are loose sanity checks; README "Performance baselines" records the
// provisional numbers.

interface Span {
  duration: number;
  detail: Record<string, number> | null;
}

/** The latest measure `name` whose detail passes `done`. */
async function span(
  page: Page,
  name: string,
  done: (detail: Record<string, number>) => boolean,
): Promise<Span> {
  let found: Span | undefined;
  await expect
    .poll(
      async () => {
        const spans = await page.evaluate(
          (n) =>
            performance.getEntriesByName(n, "measure").map((e) => ({
              duration: e.duration,
              detail: (e as PerformanceMeasure).detail as Record<
                string,
                number
              > | null,
            })),
          name,
        );
        found = spans.reverse().find((s) => s.detail && done(s.detail));
        return Boolean(found);
      },
      { timeout: 90_000, intervals: [250] },
    )
    .toBe(true);
  return found!;
}

function report(what: string, ms: number) {
  const line = `${what}: ${Math.round(ms)} ms`;
  test.info().annotations.push({ type: "performance", description: line });
  console.log(`[perf] ${line}`);
}

test.setTimeout(180_000);

test("draws a geometry of about 500k triangles", async ({ page }) => {
  await page.goto(`/p/p-baseline/geometry${TOKEN}`);
  await mock(page, "largeGeometry");
  await page.getByRole("link", { name: "Baseline assembly" }).click();
  const drawn = await span(
    page,
    "nebula:geometry-draw",
    (d) => d.triangles! > 500_000,
  );
  report(`Geometry, ${drawn.detail!.triangles} triangles`, drawn.duration);
  expect(drawn.duration).toBeLessThan(60_000);
  // Still interactive: selecting a component answers promptly.
  const started = Date.now();
  await page
    .getByRole("navigation", { name: "Assembly" })
    .getByRole("button", { name: /^Vacuum vessel/ })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Properties" }),
  ).toContainText("Vacuum vessel");
  report("Selection with the large geometry", Date.now() - started);
});

async function openWithPoints(page: Page, output: string, points: number) {
  await page.goto(
    `/p/p-baseline/results/r-14?output=${encodeURIComponent(output)}${TOKEN}`,
  );
  await expect(page.getByRole("status", { name: "View status" })).toHaveText(
    "Up to date",
  );
  await page.getByLabel("Points (0: server default)").fill(String(points));
}

test("draws a 1M-point vtk.js payload", async ({ page }) => {
  await openWithPoints(page, "field/field", 1_000_000);
  const drawn = await span(page, "nebula:view-draw", (d) => d.points! >= 1e6);
  report(`vtk.js slice, ${drawn.detail!.points} points`, drawn.duration);
  expect(drawn.duration).toBeLessThan(60_000);
});

test("draws a 100k-point Plotly payload", async ({ page }) => {
  await openWithPoints(page, "transport/profiles", 100_000);
  const drawn = await span(
    page,
    "nebula:view-draw",
    (d) => d.points! >= 200_000,
  );
  report(`Plotly profiles, ${drawn.detail!.points} points`, drawn.duration);
  const chart = page.getByRole("figure", { name: "transport · profiles" });
  await expect(chart.locator(".scatterlayer .trace")).toHaveCount(2);
  expect(drawn.duration).toBeLessThan(60_000);
});
