import { anyUnpack } from "@bufbuild/protobuf/wkt";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import {
  CircularFilamentSchema,
  ToroidalShellSchema,
} from "../../gen/nebula/core/v1/component_pb";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { server } from "../../mocks/node";
import { scenarios } from "../../mocks/scenarios";
import { store } from "../../mocks/state";
import { unwrapComponent } from "../../entities/content";
import { renderRoute } from "../../test/render";

const P = "p-baseline";
const base = `/p/${P}/libraries`;
const C = EntityKind.COMPONENT;

const component = (id: string) => store.entity(P, C, id);
const contentOf = (id: string) => unwrapComponent(component(id)?.draft.content);
const projectMaterials = () => store.materialList(P);
const copiesOf = (entryId: string) =>
  projectMaterials().filter((m) => m.source?.entryId === entryId);

const saveStatus = () =>
  screen.getByRole("status", { name: "Save status", hidden: true });

describe("Libraries", () => {
  it("lists project components and switches tabs through ?tab=", async () => {
    const { router } = renderRoute(base);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Libraries" }),
    ).toBeVisible();
    expect(
      screen.getByRole("tab", { name: "Project components" }),
    ).toHaveAttribute("aria-selected", "true");
    const pf1 = (await screen.findByRole("link", { name: "PF1" })).closest(
      "tr",
    )!;
    await waitFor(() =>
      expect(within(pf1).getByText("Circular filament")).toBeVisible(),
    );
    await waitFor(() => expect(within(pf1).getByText("Copper")).toBeVisible());

    await userEvent.click(
      screen.getByRole("tab", { name: "Global materials" }),
    );
    expect(router.state.location.search).toBe("?tab=global-materials");
    expect(await screen.findByRole("link", { name: "Nb3Sn" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Import Nb3Sn" }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("tab", { name: "Project materials" }),
    );
    expect(router.state.location.search).toBe("?tab=materials");
    const ss316 = (await screen.findByRole("link", { name: "SS316L" })).closest(
      "tr",
    )!;
    expect(within(ss316).getByText("library: SS316L")).toBeVisible();
  });

  it("imports a global component with a copy of its material and links its source (D88)", async () => {
    const { router } = renderRoute(`${base}?tab=global-components`);
    expect(
      screen.getByRole("tab", { name: "Global components" }),
    ).toHaveAttribute("aria-selected", "true");
    await userEvent.click(
      await screen.findByRole("button", { name: "Import PF coil (generic)" }),
    );
    const result = await screen.findByText(/Imported “PF coil \(generic\)”/);

    const copy = store
      .entityRecords(P, C)
      .find((record) => contentOf(record.draft.id).source?.entryId)!;
    expect(copy.draft.name).toBe("PF coil (generic)");
    const { materialId, source } = contentOf(copy.draft.id);
    expect(source?.entryId).toBe("lib-cmp-pf-coil");
    // m-copper has no source, so the library's Copper is copied in.
    const [copper] = copiesOf("lib-mat-copper");
    expect(copiesOf("lib-mat-copper")).toHaveLength(1);
    expect(materialId).toBe(copper!.id);
    expect(copper!.id).not.toBe("m-copper");

    await userEvent.click(
      within(result).getByRole("link", { name: "PF coil (generic)" }),
    );
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "PF coil (generic)",
      }),
    ).toBeVisible();
    const material = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Material",
    });
    await waitFor(() => expect(material.value).toBe(copper!.id));
    const sourceLink = await screen.findByRole("link", {
      name: "“PF coil (generic)”",
    });
    expect(sourceLink.closest("p")).toHaveTextContent(
      "Imported from library entry",
    );

    await userEvent.click(sourceLink);
    expect(router.state.location.pathname).toBe(
      `${base}/global/components/lib-cmp-pf-coil`,
    );
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "PF coil (generic)",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Import into project" }),
    ).toBeVisible();
    expect(await screen.findByRole("link", { name: "Copper" })).toHaveAttribute(
      "href",
      `${base}/global/materials/lib-mat-copper`,
    );
    expect(screen.getByText("Circular winding pack")).toBeVisible();
  });

  it("reuses the project's copy of a library material on import", async () => {
    const { router } = renderRoute(`${base}/global/components/lib-cmp-vessel`);
    await userEvent.click(
      await screen.findByRole("button", { name: "Import into project" }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(
        new RegExp(`^${base}/components/cmp-\\d+$`),
      ),
    );
    const id = router.state.location.pathname.split("/").pop()!;
    expect(
      await screen.findByRole("heading", { level: 1, name: "Vacuum vessel" }),
    ).toBeVisible();
    expect(contentOf(id).materialId).toBe("m-ss316");
    expect(copiesOf("lib-mat-ss316")).toHaveLength(1);
  });

  it("saves a component edit with a conditional PATCH", async () => {
    const ifMatch: (string | null)[] = [];
    server.use(
      http.patch(`/projects/${P}/components/cmp-pf1`, ({ request }) => {
        ifMatch.push(request.headers.get("If-Match"));
        return undefined;
      }),
    );
    renderRoute(`${base}/components/cmp-pf1`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "PF1" }),
    ).toBeVisible();
    fireEvent.change(await screen.findByLabelText(/Major radius/), {
      target: { value: "4.1" },
    });
    expect(saveStatus()).toHaveTextContent("Unsaved changes");
    await waitFor(() => expect(component("cmp-pf1")?.draft.revision).toBe(4), {
      timeout: 3000,
    });
    await waitFor(() => expect(saveStatus()).toHaveTextContent("Saved"));
    expect(ifMatch).toEqual(['"3"']);
    const shape = anyUnpack(
      contentOf("cmp-pf1").shape!,
      CircularFilamentSchema,
    );
    expect(shape?.majorRadius).toBe(4.1);
    expect(contentOf("cmp-pf1").materialId).toBe("m-copper");
  });

  it("opens the conflict dialog when another client edits meanwhile (D148)", async () => {
    // The other client's edit lands just before this client's save.
    server.use(
      http.patch(
        `/projects/${P}/components/cmp-pf1`,
        () => {
          scenarios.concurrentEdit(P, C, "cmp-pf1");
          return undefined;
        },
        { once: true },
      ),
    );
    renderRoute(`${base}/components/cmp-pf1`);
    fireEvent.change(await screen.findByLabelText(/Major radius/), {
      target: { value: "4.1" },
    });
    expect(
      await screen.findByRole(
        "dialog",
        { name: "Edited elsewhere" },
        { timeout: 3000 },
      ),
    ).toBeVisible();
    expect(saveStatus()).toHaveTextContent("Edited elsewhere");

    await userEvent.click(
      screen.getByRole("button", { name: "Keep server version" }),
    );
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "PF1 (edited elsewhere)",
      }),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveDisplayValue(
      "PF1 (edited elsewhere)",
    );
  });

  it("shows the draft-vs-head state in the component's version list", async () => {
    renderRoute(`${base}/components/cmp-pf2`);
    const versions = await screen.findByRole("region", { name: "Versions" });
    expect(
      await within(versions).findByRole("status", { name: "Draft state" }),
    ).toHaveTextContent("Draft changed since head version");
  });

  it("adds a component to the global library", async () => {
    renderRoute(`${base}/components/cmp-pf1`);
    const add = await screen.findByRole("button", {
      name: "Add to global library",
    });
    await waitFor(() => expect(add).toBeEnabled());
    await userEvent.click(add);
    expect(
      await screen.findByText(/Added to the global library as/),
    ).toBeVisible();
    const added = store.library.components.find((c) => c.name === "PF1");
    expect(added).toBeDefined();
    expect(screen.getByRole("link", { name: "PF1" })).toHaveAttribute(
      "href",
      `${base}/global/components/${added!.id}`,
    );
  });

  it("adds a component to the global library only once its edit is saved", async () => {
    renderRoute(`${base}/components/cmp-pf1`);
    const add = await screen.findByRole("button", {
      name: "Add to global library",
    });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "PF1 renamed" },
    });
    // The server copies its draft, which lacks the edit until it is saved.
    expect(add).toBeDisabled();
    await waitFor(() => expect(add).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(add);
    await screen.findByText(/Added to the global library as/);
    expect(store.library.components.some((c) => c.name === "PF1 renamed")).toBe(
      true,
    );
  });

  it("refuses to delete a component a geometry uses", async () => {
    renderRoute(base);
    await userEvent.click(
      await screen.findByRole("button", { name: "Delete PF1" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Cannot delete “PF1”: Referenced by geometry "Baseline assembly"',
    );
    expect(component("cmp-pf1")).toBeDefined();
    expect(screen.getByRole("link", { name: "PF1" })).toBeVisible();
  });

  it("refuses to delete a used component from its detail view", async () => {
    const { router } = renderRoute(`${base}/components/cmp-vessel`);
    await userEvent.click(
      await screen.findByRole("button", { name: "Delete" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Referenced by geometry",
    );
    expect(router.state.location.pathname).toBe(
      `${base}/components/cmp-vessel`,
    );
  });

  it("creates a component of a chosen shape, then deletes it", async () => {
    const { router } = renderRoute(base);
    await userEvent.click(
      await screen.findByRole("button", { name: "New component" }),
    );
    const dialog = screen.getByRole("dialog", { name: "New component" });
    const shape = within(dialog).getByLabelText("Shape type");
    await waitFor(() =>
      expect(within(shape).getByText("Toroidal shell")).toBeInTheDocument(),
    );
    await userEvent.type(within(dialog).getByLabelText("Name"), "Outer shell");
    await userEvent.selectOptions(shape, "Toroidal shell");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create component" }),
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Outer shell" }),
    ).toBeVisible();
    const id = router.state.location.pathname.split("/").pop()!;
    const record = component(id)!;
    expect(record.draft.revision).toBe(1);
    expect(anyUnpack(contentOf(id).shape!, ToroidalShellSchema)).toBeDefined();
    expect(await screen.findByText("Toroidal shell")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(router.state.location.search).toBe("?tab=components"),
    );
    expect(component(id)).toBeUndefined();
    await screen.findByRole("link", { name: "PF1" });
    expect(screen.queryByRole("link", { name: "Outer shell" })).toBeNull();
  });

  it("edits and saves a material's properties", async () => {
    renderRoute(`${base}/materials/m-copper`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Copper" }),
    ).toBeVisible();
    expect(saveStatus()).toHaveTextContent("Saved");
    fireEvent.change(screen.getByLabelText(/Density/), {
      target: { value: "8900" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Copper (OFHC)" },
    });
    expect(saveStatus()).toHaveTextContent("Unsaved changes");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveStatus()).toHaveTextContent("Saved"));
    const saved = store.material(P, "m-copper")!;
    expect(saved.name).toBe("Copper (OFHC)");
    expect(saved.properties?.density).toBe(8900);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Copper (OFHC)" }),
    ).toBeVisible();
  });

  it("adds a material to the global library only once its edit is saved", async () => {
    renderRoute(`${base}/materials/m-copper`);
    const add = await screen.findByRole("button", {
      name: "Add to global library",
    });
    expect(add).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/Density/), {
      target: { value: "8900" },
    });
    // The server copies its stored material, which lacks the edit.
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute("title", "Save your changes first");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(add).toBeEnabled());
    await userEvent.click(add);
    await screen.findByText(/Added to the global library as/);
    const added = store.library.materials.at(-1)!;
    expect(added.name).toBe("Copper");
    expect(added.properties?.density).toBe(8900);
  });

  it("keeps a material edit made while its save is in flight unsaved", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.put(`/projects/${P}/materials/m-copper`, async () => {
        await gate;
        return undefined;
      }),
    );
    renderRoute(`${base}/materials/m-copper`);
    const name = await screen.findByRole("textbox", { name: "Name" });
    await waitFor(() => expect(name).toHaveDisplayValue("Copper"));
    fireEvent.change(name, { target: { value: "Copper A" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveStatus()).toHaveTextContent("Saving…");
    fireEvent.change(name, { target: { value: "Copper B" } });
    release();
    await waitFor(() =>
      expect(store.material(P, "m-copper")?.name).toBe("Copper A"),
    );
    await waitFor(() =>
      expect(saveStatus()).toHaveTextContent("Unsaved changes"),
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(name).toHaveDisplayValue("Copper B");
  });

  it("shows a server rejection of a material name", async () => {
    renderRoute(`${base}/materials/m-copper`);
    const name = await screen.findByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value: "   " } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(name).toHaveAttribute("aria-invalid", "true"));
    expect(name).toHaveAccessibleDescription("A name is required");
    expect(saveStatus()).toHaveTextContent("Not saved");
    expect(
      screen.getByRole("button", { name: "Add to global library" }),
    ).toBeDisabled();
    expect(store.material(P, "m-copper")?.name).toBe("Copper");
  });

  it("links an imported material to its library entry", async () => {
    renderRoute(`${base}/materials/m-ss316`);
    expect(
      await screen.findByRole("link", { name: "“SS316L”" }),
    ).toHaveAttribute("href", `${base}/global/materials/lib-mat-ss316`);
  });

  it("refuses to delete a material a component uses", async () => {
    renderRoute(`${base}?tab=materials`);
    await userEvent.click(
      await screen.findByRole("button", { name: "Delete Copper" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cannot delete “Copper”: Referenced by component",
    );
    expect(store.material(P, "m-copper")).toBeDefined();
  });

  it("creates a material and imports one from the global library", async () => {
    const { router } = renderRoute(`${base}?tab=materials`);
    await userEvent.click(
      await screen.findByRole("button", { name: "New material" }),
    );
    const dialog = screen.getByRole("dialog", { name: "New material" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "Tungsten");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create material" }),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Tungsten" }),
    ).toBeVisible();
    expect(projectMaterials().map((m) => m.name)).toContain("Tungsten");

    await router.navigate(`${base}?tab=global-materials`);
    await userEvent.click(
      await screen.findByRole("button", { name: "Import Nb3Sn" }),
    );
    const result = await screen.findByText(/Imported “Nb3Sn”/);
    const [copy] = copiesOf("lib-mat-nb3sn");
    expect(within(result).getByRole("link", { name: "Nb3Sn" })).toHaveAttribute(
      "href",
      `${base}/materials/${copy!.id}`,
    );
  });

  it("rejects a blank material name", async () => {
    renderRoute(`${base}?tab=materials`);
    await userEvent.click(
      await screen.findByRole("button", { name: "New material" }),
    );
    const dialog = screen.getByRole("dialog", { name: "New material" });
    const before = projectMaterials().length;
    await userEvent.type(within(dialog).getByLabelText("Name"), "   ");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create material" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "A name is required",
    );
    expect(projectMaterials()).toHaveLength(before);
  });

  it("shows not-found pages for unknown items", async () => {
    const { router } = renderRoute(`${base}/components/cmp-nope`);
    expect(
      await screen.findByRole("heading", { name: "Component not found" }),
    ).toBeVisible();
    await router.navigate(`${base}/global/materials/lib-nope`);
    expect(
      await screen.findByRole("heading", { name: "Library entry not found" }),
    ).toBeVisible();
  });
});
