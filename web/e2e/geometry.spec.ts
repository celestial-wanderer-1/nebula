import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { createProject, mock, TOKEN } from "./helpers";

// EntityKind.COMPONENT; e2e tests do not import the generated code.
const COMPONENT = 2;
const TOKAMAK_COMPONENTS = [
  "cmp-pf1",
  "cmp-pf2",
  "cmp-pf3",
  "cmp-pf4",
  "cmp-cs",
  "cmp-div",
  "cmp-vessel",
];

const viewport = (page: Page) => page.getByTestId("viewport");
const tree = (page: Page) => page.getByRole("navigation", { name: "Assembly" });
const properties = (page: Page) =>
  page.getByRole("complementary", { name: "Properties" });

/** The viewport draws on a WebGL canvas, not the jsdom-style fallback. */
async function expectCanvas(page: Page) {
  await expect(viewport(page).locator("canvas")).toBeVisible();
  await expect(page.getByText("3D view unavailable")).toHaveCount(0);
}

async function openGeometry(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Project" })
    .getByRole("link", { name: "Geometry" })
    .click();
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

async function openBaseline(page: Page) {
  await page.goto(`/p/p-baseline/geometry/geo-main${TOKEN}`);
  await expect(
    page.getByRole("heading", { name: "Baseline assembly", level: 1 }),
  ).toBeVisible();
  await expect(viewport(page)).toHaveAttribute(
    "data-mesh-revisions",
    /cmp-pf1:3/,
  );
}

async function selectPf1(page: Page) {
  await tree(page)
    .getByRole("button", { name: /^PF1 draft/ })
    .click();
  const radius = properties(page).getByLabel(/Major radius/);
  await expect(radius).toBeVisible();
  return radius;
}

test("renders a new Tokamak project's geometry in 3D", async ({ page }) => {
  await page.goto(`/${TOKEN}`);
  await createProject(page, "Tokamak starter", "E2E geometry");
  await openGeometry(page, "Reference assembly");

  await expectCanvas(page);
  for (const id of TOKAMAK_COMPONENTS) {
    await expect(viewport(page)).toHaveAttribute(
      "data-mesh-revisions",
      new RegExp(`(^|,)${id}:1(,|$)`),
    );
  }
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("replaces a mesh with the build of the edited revision", async ({
  page,
}) => {
  await openBaseline(page);
  await expectCanvas(page);
  const radius = await selectPf1(page);
  await radius.fill("4.2");

  await expect(viewport(page)).toHaveAttribute(
    "data-mesh-revisions",
    /(^|,)cmp-pf1:4(,|$)/,
  );
  await expect(
    properties(page).getByRole("status", { name: "Save status" }),
  ).toHaveText("Saved");
});

test("asks what to keep when another client edits the component", async ({
  page,
}) => {
  await openBaseline(page);
  const radius = await selectPf1(page);
  // The other client saves before this edit's debounced PATCH goes out.
  await radius.fill("4.4");
  await mock(page, "concurrentEdit", "p-baseline", COMPONENT, "cmp-pf1");

  const dialog = page.getByRole("dialog", { name: "Edited elsewhere" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep server version" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    properties(page).getByRole("textbox", { name: "Name" }),
  ).toHaveValue("PF1 (edited elsewhere)");
  await expect(
    properties(page).getByRole("status", { name: "Save status" }),
  ).toHaveText("Saved");
});

test("exports the geometry draft as STEP", async ({ page }) => {
  await openBaseline(page);
  // An edit holds the export back until it is saved, then is in the file.
  await page
    .getByRole("group", { name: "Geometry draft" })
    .getByRole("textbox", { name: "Geometry name" })
    .fill("Baseline assembly E2E");
  const exportStep = page.getByRole("button", { name: "Export STEP" });
  await expect(exportStep).toBeDisabled();
  await expect(exportStep).toBeEnabled();
  const download = page.waitForEvent("download");
  await exportStep.click();
  const file = await download;

  expect(file.suggestedFilename()).toBe("Baseline-assembly-E2E.step");
  const body = await readFile(await file.path(), "utf8");
  expect(body.startsWith("ISO-10303-21")).toBe(true);
});

test("imports a global library component and follows its source link", async ({
  page,
}) => {
  await page.goto(`/p/p-baseline/libraries${TOKEN}`);
  await page.getByRole("tab", { name: "Global components" }).click();
  await page.getByRole("button", { name: "Import PF coil (generic)" }).click();

  const result = page.getByRole("status").filter({ hasText: "Imported" });
  await expect(result).toContainText("Imported “PF coil (generic)”");
  await result.getByRole("link", { name: "PF coil (generic)" }).click();
  await expect(
    page.getByRole("heading", { name: "PF coil (generic)", level: 1 }),
  ).toBeVisible();

  await page.getByRole("link", { name: "“PF coil (generic)”" }).click();
  await expect(page).toHaveURL(
    /\/p\/p-baseline\/libraries\/global\/components\/lib-cmp-pf-coil$/,
  );
  await expect(
    page.getByRole("heading", { name: "PF coil (generic)", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import into project" }),
  ).toBeVisible();
  await expect(page.getByText("Circular winding pack")).toBeVisible();
});

test("toggles symmetry replicas of a stellarator", async ({ page }) => {
  await page.goto(`/${TOKEN}`);
  await createProject(page, "Stellarator starter", "E2E stellarator");
  await openGeometry(page, "Reference assembly");
  await expectCanvas(page);
  await expect(viewport(page)).toHaveAttribute(
    "data-mesh-revisions",
    /cmp-plasma:1/,
  );

  // The modular coils' circuit replicates over N_fp = 5: four copies each.
  const drawn = "cmp-mc1:4,cmp-mc2:4";
  await expect(viewport(page)).toHaveAttribute("data-replicas", drawn);

  const replicas = page.getByRole("checkbox", {
    name: "Show symmetry replicas",
  });
  await expect(replicas).toBeChecked();
  await replicas.uncheck();
  await expect(viewport(page)).toHaveAttribute("data-replicas", "");
  await replicas.check();
  await expect(viewport(page)).toHaveAttribute("data-replicas", drawn);
  await expectCanvas(page);
});
