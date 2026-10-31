import { TOKEN } from "./helpers";
import { expect, test } from "./test";

// docs/UI.md 6.10: plugins, settings and storage.

test("shows plugins with their smoke results", async ({ page }) => {
  await page.goto(`/${TOKEN}`);
  await page.getByRole("link", { name: /2 plugins/ }).click();
  const acme = page.getByRole("region", { name: "acme.demo 1.2.0" });
  await expect(acme).toContainText("Nebula ABI 1");
  await expect(acme.getByRole("row", { name: /W7900/ })).toContainText(
    "failed",
  );
});

test("switches a project's strict cache in the settings", async ({ page }) => {
  await page.goto(`/${TOKEN}`);
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByLabel("Configuration file")).toContainText(
    "[storage]",
  );
  const toggle = page.getByRole("switch", { name: "Tokamak baseline" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
});

test("evicts derived artifacts and deletes results after the dependency check", async ({
  page,
}) => {
  await page.goto(`/p/p-baseline/storage${TOKEN}`);
  const classes = page.getByRole("table", { name: "Storage by class" });
  await classes.getByRole("button", { name: "Evict meshes" }).click();
  await expect(page.getByRole("status", { name: "Eviction" })).toContainText(
    "Freed",
  );
  await expect(classes.getByRole("row", { name: /Meshes/ })).toContainText(
    "0 B",
  );

  await page
    .getByRole("button", { name: "Delete results of Field to stability #3" })
    .click();
  const dialog = page.getByRole("dialog", { name: /Delete results of/ });
  await expect(dialog).toContainText("Nothing refers to these outputs.");
  await dialog.getByRole("button", { name: "Delete results" }).click();
  await expect(
    page.getByRole("button", {
      name: "Delete results of Field to stability #3",
    }),
  ).toHaveCount(0);
});
