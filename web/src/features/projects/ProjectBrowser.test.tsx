import { File as NodeFile } from "node:buffer";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { store } from "../../mocks/state";
import { MOCK_BUILD_ID } from "../../mocks/token";
import { renderRoute } from "../../test/render";

async function openBrowser() {
  const result = renderRoute("/");
  await screen.findByRole("link", { name: "Tokamak baseline" });
  return result;
}

// Node's fetch reads Node files, not jsdom's; browsers take either.
function file(text: string, name: string): File {
  return new NodeFile([text], name) as unknown as File;
}

function exportFile(buildId: string, runCount = 3) {
  const text = JSON.stringify({
    format: "nebula-mock-export/1",
    buildId,
    project: { id: "x", name: "Foreign project", runCount },
  });
  return file(text, "foreign.nebula");
}

describe("ProjectBrowser", () => {
  it("lists projects and tags imported non-reproducible runs (D100, D149)", async () => {
    await openBrowser();
    const imported = screen
      .getByRole("link", { name: "Stellarator from lab B" })
      .closest("tr")!;
    expect(
      within(imported).getByText("viewable, not reproducible here"),
    ).toBeVisible();
    const baseline = screen
      .getByRole("link", { name: "Tokamak baseline" })
      .closest("tr")!;
    expect(within(baseline).queryByText(/not reproducible/)).toBeNull();
    expect(within(baseline).getByText("Tokamak")).toBeVisible();
  });

  it.each(["Tokamak", "Simple mirror", "Stellarator"])(
    "creates a project from the %s concept kit and opens it",
    async (kit) => {
      const { router } = await openBrowser();
      await userEvent.click(
        screen.getByRole("button", { name: "New project" }),
      );
      const dialog = screen.getByRole("dialog", { name: "New project" });
      const template = within(dialog).getByLabelText("Template");
      await waitFor(() =>
        expect(
          within(template).getByText(`${kit} starter`),
        ).toBeInTheDocument(),
      );
      await userEvent.selectOptions(template, `${kit} starter`);
      await userEvent.type(within(dialog).getByLabelText("Name"), `My ${kit}`);
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Create project" }),
      );

      expect(
        await screen.findByRole("heading", { name: `My ${kit}` }),
      ).toBeVisible();
      expect(router.state.location.pathname).toMatch(/^\/p\/p-\d+$/);
      expect(screen.getByText(`${kit} 1.0.0`)).toBeVisible();
    },
  );

  it("shows the server's field error when a name is blank", async () => {
    await openBrowser();
    await userEvent.click(screen.getByRole("button", { name: "New project" }));
    const dialog = screen.getByRole("dialog", { name: "New project" });
    const template = within(dialog).getByLabelText("Template");
    await waitFor(() =>
      expect(within(template).getByText("Tokamak starter")).toBeInTheDocument(),
    );
    await userEvent.selectOptions(template, "Tokamak starter");
    await userEvent.type(within(dialog).getByLabelText("Name"), "   ");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create project" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "A name is required",
    );
  });

  it("imports a snapshot from another build with a warning", async () => {
    await openBrowser();
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    const dialog = screen.getByRole("dialog", { name: "Import project" });
    await userEvent.upload(
      within(dialog).getByLabelText("Project export"),
      exportFile("other-build-7"),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Import" }),
    );

    expect(
      await within(dialog).findByText("Imported “Foreign project”."),
    ).toBeVisible();
    const issues = within(dialog).getByRole("list", { name: "Import issues" });
    expect(issues).toHaveTextContent("Warning");
    expect(issues).toHaveTextContent("viewable, not reproducible here");

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Close" }),
    );
    const row = (
      await screen.findByRole("link", { name: "Foreign project" })
    ).closest("tr")!;
    expect(
      within(row).getByText("viewable, not reproducible here"),
    ).toBeVisible();
  });

  it("imports a snapshot from this build without warnings", async () => {
    await openBrowser();
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    const dialog = screen.getByRole("dialog", { name: "Import project" });
    await userEvent.upload(
      within(dialog).getByLabelText("Project export"),
      exportFile(MOCK_BUILD_ID),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Import" }),
    );
    expect(
      await within(dialog).findByText("Imported “Foreign project”."),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole("list", { name: "Import issues" }),
    ).toBeNull();
  });

  it("shows validation errors for a rejected import", async () => {
    await openBrowser();
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    const dialog = screen.getByRole("dialog", { name: "Import project" });
    await userEvent.upload(
      within(dialog).getByLabelText("Project export"),
      file("not a snapshot", "junk.nebula"),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Import" }),
    );
    expect(
      await within(dialog).findByText("The import was rejected."),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("list", { name: "Import issues" }),
    ).toHaveTextContent("ErrorNot a Nebula project export");
  });

  it("saves a project as a template that new projects can use (D86)", async () => {
    await openBrowser();
    await userEvent.click(
      screen.getByRole("button", { name: "Save as template Tokamak baseline" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Save “Tokamak baseline” as a template",
    });
    await userEvent.type(
      within(dialog).getByLabelText("Template name"),
      "Baseline v2",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save template" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(store.templates.map((t) => t.name)).toContain("Baseline v2");

    await userEvent.click(screen.getByRole("button", { name: "New project" }));
    const template = within(
      screen.getByRole("dialog", { name: "New project" }),
    ).getByLabelText("Template");
    await waitFor(() =>
      expect(
        within(template).getByRole("group", { name: "Saved templates" }),
      ).toHaveTextContent("Baseline v2"),
    );
  });
});
