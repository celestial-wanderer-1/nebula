import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { TOKEN } from "./helpers";
import { expect, test } from "./test";

// Accessibility pass (docs/UI.md P7): axe finds no WCAG 2 A or AA
// violation on any area or dialog.

async function expectAccessible(page: Page, what: string) {
  // Wait for lazy chunks and queries to settle before scanning.
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/^Loading/)).toHaveCount(0);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    violations.map(
      (v) =>
        `${what}: ${v.id} (${v.impact}) ${v.help}\n    ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(" "))
          .join("\n    ")}`,
    ),
  ).toEqual([]);
}

const PAGES: [string, string][] = [
  ["Projects", "/"],
  ["Plugins", "/admin/plugins"],
  ["Settings", "/admin/settings"],
  ["Overview", "/p/p-baseline"],
  ["Geometry list", "/p/p-baseline/geometry"],
  ["Geometry editor", "/p/p-baseline/geometry/geo-main"],
  ["Libraries", "/p/p-baseline/libraries"],
  ["Materials", "/p/p-baseline/libraries?tab=materials"],
  ["Global components", "/p/p-baseline/libraries?tab=global-components"],
  ["Global materials", "/p/p-baseline/libraries?tab=global-materials"],
  ["Component", "/p/p-baseline/libraries/components/cmp-pf1"],
  ["Regions", "/p/p-baseline/regions"],
  ["Region editor", "/p/p-baseline/regions/reg-box"],
  ["Scenarios", "/p/p-baseline/scenarios"],
  ["Scenario editor", "/p/p-baseline/scenarios/scn-flattop"],
  ["Conductor networks", "/p/p-baseline/conductor-networks"],
  ["Conductor network editor", "/p/p-baseline/conductor-networks/cn-vessel"],
  ["Workflows", "/p/p-baseline/workflows"],
  ["Workflow editor", "/p/p-baseline/workflows/wf-chain"],
  ["Runs", "/p/p-baseline/runs"],
  ["Queue", "/p/p-baseline/runs?tab=queue"],
  ["Run detail", "/p/p-baseline/runs/r-11"],
  ["Results", "/p/p-baseline/results"],
  ["Run results", "/p/p-baseline/results/r-11?output=t1%2Fequilibrium"],
  ["Comparison", "/p/p-baseline/comparison"],
  ["Studies", "/p/p-baseline/studies"],
  ["New study", "/p/p-baseline/studies/new"],
  ["Storage", "/p/p-baseline/storage"],
];

for (const [name, path] of PAGES) {
  test(`${name} has no accessibility violations`, async ({ page }) => {
    await page.goto(`${path}${TOKEN}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expectAccessible(page, name);
  });
}

// Dialogs and menus, each opened from its page.
const DIALOGS: [string, string, (page: Page) => Locator][] = [
  [
    "New project",
    "/",
    (page) => page.getByRole("button", { name: "New project" }),
  ],
  [
    "Import project",
    "/",
    (page) => page.getByRole("button", { name: "Import", exact: true }),
  ],
  [
    "Save as template",
    "/",
    (page) =>
      page.getByRole("button", { name: "Save as template Tokamak baseline" }),
  ],
  [
    "Project switcher",
    "/p/p-baseline",
    (page) => page.getByRole("button", { name: /^Switch project/ }),
  ],
  [
    "New geometry",
    "/p/p-baseline/geometry",
    (page) => page.getByRole("button", { name: "New geometry" }),
  ],
  [
    "Add component",
    "/p/p-baseline/geometry/geo-main",
    (page) => page.getByRole("button", { name: "Add component" }),
  ],
  [
    "New component",
    "/p/p-baseline/libraries",
    (page) => page.getByRole("button", { name: "New component" }),
  ],
  [
    "New material",
    "/p/p-baseline/libraries?tab=materials",
    (page) => page.getByRole("button", { name: "New material" }),
  ],
  [
    "New region",
    "/p/p-baseline/regions",
    (page) => page.getByRole("button", { name: "New region" }),
  ],
  [
    "New workflow",
    "/p/p-baseline/workflows",
    (page) => page.getByRole("button", { name: "New workflow" }),
  ],
  [
    "Workflow from a template",
    "/p/p-baseline/workflows",
    (page) => page.getByRole("button", { name: "From template" }),
  ],
  [
    "Submit run",
    "/p/p-baseline/workflows/wf-chain",
    (page) => page.getByRole("button", { name: "Run…" }),
  ],
  [
    "Delete results",
    "/p/p-baseline/storage",
    (page) =>
      page.getByRole("button", {
        name: "Delete results of Field to stability #3",
      }),
  ],
];

for (const [name, path, trigger] of DIALOGS) {
  test(`${name} dialog has no accessibility violations`, async ({ page }) => {
    await page.goto(`${path}${TOKEN}`);
    await trigger(page).click();
    await expect(
      page.getByRole("dialog").or(page.getByRole("menu")),
    ).toBeVisible();
    await expectAccessible(page, name);
  });
}

test("results viewers have no accessibility violations", async ({ page }) => {
  await page.goto(
    `/p/p-baseline/results/r-14?output=transport%2Fprofiles${TOKEN}`,
  );
  await expect(
    page.getByRole("figure", { name: "transport · profiles" }),
  ).toBeVisible();
  await expectAccessible(page, "Profile viewer");
  await page.getByRole("button", { name: "Time trace" }).click();
  await expectAccessible(page, "Time trace viewer");
});

test("a comparison and a study have no accessibility violations", async ({
  page,
}) => {
  await page.goto(`/p/p-baseline/comparison${TOKEN}`);
  const form = page.getByRole("form", { name: "New comparison" });
  await form.getByRole("checkbox", { name: /Field to stability #11/ }).check();
  await form.getByRole("checkbox", { name: /Field to stability #3/ }).check();
  await form
    .getByRole("group", { name: "Shared region" })
    .getByLabel("Region", { exact: true })
    .selectOption({ label: "Poloidal plane" });
  await form.getByRole("button", { name: "Compare 2 runs" }).click();
  await expect(
    page.getByRole("status", { name: "Comparison summary" }),
  ).toBeVisible();
  for (const tab of ["Scalars", "Profiles", "Difference", "Linked 3D"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expectAccessible(page, `Comparison ${tab}`);
  }

  await page
    .getByRole("navigation", { name: "Project" })
    .getByRole("link", { name: "Studies" })
    .click();
  await page.getByRole("link", { name: "New parameter scan" }).click();
  await page.getByLabel("Name").fill("Scan");
  await page
    .getByLabel("Base workflow")
    .selectOption({ label: "Field to stability" });
  await page.getByRole("checkbox", { name: /Current of PF/ }).check();
  await expectAccessible(page, "Study editor");
  await page.getByRole("button", { name: "Create scan" }).click();
  await expect(page.getByRole("table", { name: "Points" })).toBeVisible();
  await expectAccessible(page, "Study detail");
});

// Keyboard flows: everything a pointer does has a keyboard route.
test("skips to the content and moves between areas by keyboard", async ({
  page,
}) => {
  await page.goto(`/p/p-baseline${TOKEN}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();

  const nav = page.getByRole("navigation", { name: "Project" });
  await nav.getByRole("link", { name: "Workflows" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Workflows", level: 1 }),
  ).toBeVisible();
});

test("opens, uses and dismisses dialogs by keyboard", async ({ page }) => {
  await page.goto(`/p/p-baseline/workflows${TOKEN}`);
  const trigger = page.getByRole("button", { name: "From template" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "New workflow from a template",
  });
  await expect(dialog).toBeVisible();
  // Focus moves into the dialog and stays there.
  await expect(dialog.locator(":focus")).toHaveCount(1);
  for (let i = 0; i < 10; i++) await page.keyboard.press("Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("builds a workflow by keyboard with the palette and connect form", async ({
  page,
}) => {
  await page.goto(`/p/p-baseline/workflows${TOKEN}`);
  await page.getByRole("button", { name: "New workflow" }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New workflow" });
  await dialog.getByLabel("Name").focus();
  await page.keyboard.type("Keyboard chain");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Keyboard chain", level: 1 }),
  ).toBeVisible();

  const palette = page.getByRole("navigation", { name: "Palette" });
  await palette.getByRole("button", { name: "Biot–Savart field" }).focus();
  await page.keyboard.press("Enter");
  await palette.getByRole("button", { name: "T1 equilibrium" }).focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("region", { name: "Node T1 equilibrium" });
  const connect = panel.getByLabel("Connect field from");
  await connect.focus();
  await connect.selectOption({
    label: "Biot–Savart field · operator (MagneticField.Operator)",
  });
  const canvas = page.getByTestId("flow-canvas");
  await expect(canvas).toHaveAttribute("data-edges", "1");
  await expect(panel).toContainText("From Biot–Savart field · operator");
  // The canvas names its nodes and edges for screen readers.
  await expect(
    canvas.getByRole("group", { name: "Solver step T1 equilibrium" }),
  ).toBeVisible();
  await expect(
    canvas.getByRole("group", {
      name: "Biot–Savart field operator to T1 equilibrium field",
    }),
  ).toBeAttached();
  await expectAccessible(page, "Built workflow");
});
