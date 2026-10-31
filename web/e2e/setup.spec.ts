import { expect, test, type Page } from "@playwright/test";
import { createProject, TOKEN, trackErrors } from "./helpers";

// docs/UI.md 6.4: a field calculation's inputs (geometry, region, scenario
// with coil currents) can be authored end to end without the SDK.

async function openArea(page: Page, area: string) {
  await page
    .getByRole("navigation", { name: "Project" })
    .getByRole("link", { name: area })
    .click();
  await expect(
    page.getByRole("heading", { name: area, level: 1 }),
  ).toBeVisible();
}

async function createEntity(page: Page, kind: string, name: string) {
  await page.getByRole("button", { name: `New ${kind}` }).click();
  const dialog = page.getByRole("dialog", { name: `New ${kind}` });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: `Create ${kind}` }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

async function expectSaved(page: Page) {
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "Saved",
    { timeout: 5000 },
  );
}

const field = (page: Page, path: string) =>
  page.locator(`[data-path="${path}"]`);

test("authors the inputs of a field calculation without the SDK", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto(`/${TOKEN}`);
  await createProject(page, "Tokamak starter", "E2E setup");

  // A box-grid region placed over the starter geometry.
  await openArea(page, "Regions");
  await createEntity(page, "region", "Divertor box");
  const geometryPicker = page.getByRole("group", { name: "Geometry" });
  await geometryPicker
    .getByLabel("Geometry", { exact: true })
    .selectOption({ label: "Reference assembly" });
  await page.getByLabel("Shape").selectOption({ label: "Box grid" });
  await field(page, "box_grid.min").getByLabel("X [m]").fill("4");
  await field(page, "box_grid.min").getByLabel("Z [m]").fill("-7");
  await field(page, "box_grid.max").getByLabel("X [m]").fill("7");
  await field(page, "box_grid.max").getByLabel("Y [m]").fill("1");
  await field(page, "box_grid.max").getByLabel("Z [m]").fill("-4");
  const placement = page.getByTestId("placement");
  await expect(placement).toHaveAttribute("data-region-lines", "12");
  await expect(placement).toHaveAttribute("data-meshes", /^[1-9]/);
  await expect(placement.locator("canvas")).toBeVisible();
  await expectSaved(page);

  // A scenario with currents keyed by the geometry's circuits (D114).
  await openArea(page, "Scenarios");
  await createEntity(page, "scenario", "Ramp-up");
  await page
    .getByRole("group", { name: "Geometry" })
    .getByLabel("Geometry", { exact: true })
    .selectOption({ label: "Reference assembly" });
  const currents = page.getByRole("region", { name: "Circuit currents" });
  for (const [circuit, current] of [
    ["PF", "45000"],
    ["CS", "-30000"],
    ["Divertor", "20000"],
  ] as const) {
    await currents
      .getByRole("button", { name: `Set current of ${circuit}` })
      .click();
    await currents
      .getByRole("textbox", { name: `Current of ${circuit}` })
      .fill(current);
  }
  // A ramp waveform for PF, previewed in Plotly.
  await currents.getByRole("button", { name: "Static" }).first().click();
  const waveform = page.getByRole("group", { name: "Current of PF waveform" });
  await waveform.getByRole("button", { name: "Add point" }).click();
  await waveform.getByRole("button", { name: "Add point" }).click();
  await waveform.getByLabel("Value 2").fill("45000");
  await expect(
    waveform.getByRole("img", { name: "Current of PF against time" }),
  ).toBeVisible();
  await page
    .getByLabel("Add plasma targets")
    .selectOption({ label: "Plasma targets" });
  await page.getByLabel("Plasma current [A]").fill("15000000");
  await expectSaved(page);

  // Reopening shows what the server holds.
  await openArea(page, "Scenarios");
  await page.getByRole("link", { name: "Ramp-up" }).click();
  await expect(
    page
      .getByRole("region", { name: "Circuit currents" })
      .getByRole("textbox", { name: "Current of CS" }),
  ).toHaveValue("-30000");

  // A conductor network on the vessel.
  await openArea(page, "Conductor networks");
  await createEntity(page, "conductor network", "Vessel currents");
  await page
    .getByRole("group", { name: "Geometry" })
    .getByLabel("Geometry", { exact: true })
    .selectOption({ label: "Reference assembly" });
  await page.getByRole("button", { name: "Add passive elements" }).click();
  await field(page, "elements[0].component_id")
    .getByLabel("Component")
    .selectOption({ label: "Vacuum vessel" });
  await field(page, "elements[0].resistivity")
    .getByLabel("Resistivity [Ohm m]")
    .fill("7.4e-7");
  await expectSaved(page);

  // The field step takes them, and the server accepts it.
  await openArea(page, "Workflows");
  await createEntity(page, "workflow", "Field map");
  await page
    .getByRole("navigation", { name: "Palette" })
    .getByRole("button", { name: "Biot–Savart field" })
    .click();
  const node = page.getByRole("region", { name: "Node Biot–Savart field" });
  for (const [port, label] of [
    ["geometry", "Reference assembly"],
    ["scenario", "Ramp-up"],
    ["region", "Divertor box"],
  ] as const) {
    await node
      .getByRole("group", { name: new RegExp(`^${port}`) })
      .getByRole("combobox")
      .first()
      .selectOption({ label });
    await expect(
      node.getByRole("button", { name: `Unbind ${port}` }),
    ).toBeVisible();
  }
  await expectSaved(page);
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(
    page.getByRole("region", { name: "Validation" }).getByRole("status"),
  ).toHaveText("No issues: the server accepts this workflow.");
  expect(errors).toEqual([]);
});
