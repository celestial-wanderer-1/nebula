import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { createProject, TOKEN } from "./helpers";

// docs/UI.md 6.5: a full chain and a single step fed by a stored output,
// both accepted by the server; typed ports block mismatches and offer
// adapters (D55); missing traits are reported (D64).

async function openWorkflows(page: Page) {
  await page
    .getByRole("navigation", { name: "Project" })
    .getByRole("link", { name: "Workflows" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Workflows", level: 1 }),
  ).toBeVisible();
}

async function fromTemplate(page: Page, template: string, name: string) {
  await page.getByRole("button", { name: "From template" }).click();
  const dialog = page.getByRole("dialog", {
    name: "New workflow from a template",
  });
  await dialog.getByRole("radio", { name: new RegExp(template) }).check();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create workflow" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

const nodes = (page: Page) =>
  page.getByRole("region", { name: "Nodes", exact: true });

async function selectNode(page: Page, label: string) {
  const list = nodes(page);
  if (await list.isVisible()) {
    await list.getByRole("button", { name: label }).click();
  } else {
    await page
      .getByTestId("flow-canvas")
      .getByText(label, { exact: true })
      .click();
  }
  const panel = page.getByRole("region", { name: `Node ${label}` });
  await expect(panel).toBeVisible();
  return panel;
}

async function bind(page: Page, node: string, port: string, label: string) {
  const panel = await selectNode(page, node);
  await panel
    .getByRole("group", { name: new RegExp(`^${port}`) })
    .getByRole("combobox")
    .first()
    .selectOption({ label });
  await expect(
    panel.getByRole("button", { name: `Unbind ${port}` }),
  ).toBeVisible();
}

async function deselect(page: Page) {
  await page
    .getByTestId("flow-canvas")
    .locator(".react-flow__pane")
    .click({
      position: { x: 5, y: 5 },
    });
}

async function validate(page: Page) {
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "Saved",
    { timeout: 5000 },
  );
  await page.getByRole("button", { name: "Validate" }).click();
  return page.getByRole("region", { name: "Validation" });
}

async function bindChain(page: Page) {
  await bind(page, "Biot–Savart field", "geometry", "Reference assembly");
  await bind(page, "Biot–Savart field", "scenario", "Flat-top");
  await bind(page, "T1 equilibrium", "scenario", "Flat-top");
}

test("builds the full chain from a template and the server accepts it", async ({
  page,
}) => {
  await page.goto(`/${TOKEN}`);
  await createProject(page, "Tokamak starter", "E2E chain");
  await openWorkflows(page);
  await fromTemplate(page, "Field, equilibrium and stability", "Chain");
  await expect(page.getByTestId("flow-canvas")).toHaveAttribute(
    "data-edges",
    "2",
  );
  await expect(
    page.getByTestId("flow-canvas").locator(".react-flow__node"),
  ).toHaveCount(3);
  await bindChain(page);
  const result = await validate(page);
  await expect(result.getByRole("status")).toHaveText(
    "No issues: the server accepts this workflow.",
  );

  // T1 cannot feed global stability directly: an adapter is offered (D55).
  await deselect(page);
  await page
    .getByRole("navigation", { name: "Palette" })
    .getByRole("button", { name: "Global stability" })
    .click();
  const global = page.getByRole("region", { name: "Node Global stability" });
  await global.getByLabel("Connect equilibrium from").selectOption({
    label:
      "T1 equilibrium · equilibrium (Equilibrium.Axisym2D) — needs an adapter",
  });
  const offer = page.getByRole("dialog", { name: "Insert an adapter" });
  await expect(offer).toContainText(
    "does not match Equilibrium.FluxCoordinates",
  );
  await offer.getByRole("button", { name: "Insert Flux coordinates" }).click();
  await expect(page.getByTestId("flow-canvas")).toHaveAttribute(
    "data-edges",
    "4",
  );
  await expect((await validate(page)).getByRole("status")).toHaveText(
    "No issues: the server accepts this workflow.",
  );
});

test("runs a single stability step on a stored equilibrium", async ({
  page,
}) => {
  await page.goto(`/p/p-baseline/workflows${TOKEN}`);
  await fromTemplate(
    page,
    "Stability from a stored equilibrium",
    "Restability",
  );
  const stored = await selectNode(page, "Stored equilibrium");
  await stored
    .getByLabel("Run")
    .selectOption({ label: "Field to stability #11" });
  await stored
    .getByLabel("Output", { exact: true })
    .selectOption({ label: "t1 · equilibrium (Equilibrium.Axisym2D)" });
  await expect(stored).toContainText("Pinned to");
  await expect((await validate(page)).getByRole("status")).toHaveText(
    "No issues: the server accepts this workflow.",
  );
});

test("reports a trait the project's concept lacks (D64)", async ({ page }) => {
  await page.goto(`/${TOKEN}`);
  await createProject(page, "Simple mirror starter", "E2E mirror");
  await openWorkflows(page);
  await fromTemplate(page, "Field, equilibrium and stability", "Mirror chain");
  await bind(page, "Biot–Savart field", "geometry", "Reference assembly");
  await bind(page, "Biot–Savart field", "scenario", "Steady state");
  await bind(page, "T1 equilibrium", "scenario", "Steady state");
  const result = await validate(page);
  await expect(result.getByRole("status")).toHaveText(
    "1 issue to fix before a run.",
  );
  await expect(result).toContainText(
    "T1 equilibrium requires “closed_field_lines”",
  );
  await expect(
    page.getByTestId("flow-canvas").locator(".flow-node.has-issues"),
  ).toHaveCount(1);
});

test("connects typed ports by dragging on the canvas", async ({ page }) => {
  await page.goto(`/p/p-baseline/workflows${TOKEN}`);
  await page.getByRole("button", { name: "New workflow" }).click();
  const dialog = page.getByRole("dialog", { name: "New workflow" });
  await dialog.getByLabel("Name").fill("Dragged");
  await dialog.getByRole("button", { name: "Create workflow" }).click();
  const palette = page.getByRole("navigation", { name: "Palette" });
  await palette.getByRole("button", { name: "Biot–Savart field" }).click();
  await palette.getByRole("button", { name: "T1 equilibrium" }).click();
  const canvas = page.getByTestId("flow-canvas");
  await expect(canvas.locator(".react-flow__node")).toHaveCount(2);
  await canvas.getByRole("button", { name: "Fit View" }).click();
  // A mismatched pair is refused while dragging.
  await canvas
    .locator('.react-flow__handle[data-handleid="field"].source')
    .dragTo(
      canvas.locator('.react-flow__handle[data-handleid="field"].target'),
    );
  await expect(canvas).toHaveAttribute("data-edges", "0");
  await canvas
    .locator('.react-flow__handle[data-handleid="operator"]')
    .dragTo(
      canvas.locator('.react-flow__handle[data-handleid="field"].target'),
    );
  await expect(canvas).toHaveAttribute("data-edges", "1");
  await expect(canvas.locator(".react-flow__edge")).toHaveCount(1);
});
