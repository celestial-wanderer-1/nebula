import { create, toJson } from "@bufbuild/protobuf";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { packGeometry, unpackGeometry } from "../../entities/content";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import {
  CircuitSchema,
  GeometryTessellationSchema,
  type GeometryTessellation,
} from "../../gen/nebula/core/v1/geometry_pb";
import { server } from "../../mocks/node";
import { componentRef } from "../../mocks/fixtures";
import { scenarios } from "../../mocks/scenarios";
import { store } from "../../mocks/state";
import { renderRoute } from "../../test/render";
import { resetGeometryView } from "./store";
import type { ViewportProps } from "./Viewport";

// The real viewport needs WebGL. The stub exposes what it was asked to draw
// and lets a test click a component "in 3D".
vi.mock("./Viewport", async () => {
  const { meshRevisions, replicaCounts } = await import("./scene");
  return {
    Viewport: ({ components, replicas, onSelect }: ViewportProps) => (
      <div
        data-testid="viewport"
        data-mesh-revisions={meshRevisions(components)}
        data-replicas={replicaCounts(components, replicas)}
      >
        {components.map((component) => (
          <button
            key={component.componentId}
            type="button"
            onClick={() => onSelect(component.componentId)}
          >
            3D {component.componentId}
          </button>
        ))}
      </div>
    ),
  };
});

const P = "p-baseline";
const SAVE = { timeout: 3000 };

const geometryContent = (id = "geo-main") =>
  unpackGeometry(store.entity(P, EntityKind.GEOMETRY, id)!.draft.content);
const tree = () => screen.getByRole("navigation", { name: "Assembly" });
const properties = () =>
  screen.getByRole("complementary", { name: "Properties" });
const meshes = () =>
  screen.getByTestId("viewport").getAttribute("data-mesh-revisions") ?? "";
const replicas = () =>
  screen.getByTestId("viewport").getAttribute("data-replicas") ?? "";
const saveStatus = () =>
  within(screen.getByRole("group", { name: "Geometry draft" })).getByRole(
    "status",
    { name: "Save status" },
  );
const geometryName = () =>
  within(screen.getByRole("group", { name: "Geometry draft" })).getByRole(
    "textbox",
    { name: "Geometry name" },
  );
const pfMembers = () =>
  geometryContent().circuits.find((c) => c.id === "ckt-pf")?.members ?? [];

async function open(geometryId = "geo-main") {
  const rendered = renderRoute(`/p/${P}/geometry/${geometryId}`);
  await screen.findByRole("navigation", { name: "Assembly" });
  return rendered;
}

async function selectInTree(name: RegExp) {
  await userEvent.click(await within(tree()).findByRole("button", { name }));
}

beforeEach(() => resetGeometryView());

describe("GeometryEditor", () => {
  it("lists components with reference state and circuits with stable IDs", async () => {
    await open();
    expect(
      await screen.findByRole("heading", { name: "Baseline assembly" }),
    ).toBeVisible();
    const t = tree();
    expect(
      await within(t).findByRole("button", { name: /^PF1 draft/ }),
    ).toBeVisible();
    expect(
      within(t).getByRole("button", { name: /^PF2 pinned pf2-v1/ }),
    ).toBeVisible();
    for (const name of [
      "Saddle coil",
      "Vacuum vessel",
      "Feed lead",
      "Limiter profile",
    ]) {
      expect(
        within(t).getByRole("button", { name: new RegExp(`^${name}`) }),
      ).toBeVisible();
    }
    expect(within(t).getByRole("button", { name: /^PF ckt-pf/ })).toBeVisible();
    // The open feed lead is flagged (D145).
    expect(
      await within(t).findByRole("button", {
        name: /^Feed ckt-feed Has errors/,
      }),
    ).toBeVisible();
  });

  it("selects a component in the tree or the viewport", async () => {
    await open();
    await selectInTree(/^PF1/);
    const panel = properties();
    expect(
      await within(panel).findByRole("textbox", { name: "Name" }),
    ).toHaveDisplayValue("PF1");
    expect(within(panel).getByLabelText(/Major radius/)).toBeVisible();
    expect(
      within(tree()).getByRole("button", { name: /^PF1/ }),
    ).toHaveAttribute("aria-current", "true");

    await userEvent.click(
      await screen.findByRole("button", { name: "3D cmp-vessel" }),
    );
    expect(
      await within(properties()).findByRole("heading", {
        name: "Vacuum vessel",
      }),
    ).toBeVisible();
  });

  it("saves a component edit and shows the mesh of the new revision", async () => {
    const ifMatch: (string | null)[] = [];
    server.use(
      http.patch(`/projects/${P}/components/cmp-pf1`, ({ request }) => {
        ifMatch.push(request.headers.get("If-Match"));
        return undefined;
      }),
    );
    await open();
    await waitFor(() => expect(meshes()).toContain("cmp-pf1:3"));
    await selectInTree(/^PF1/);
    fireEvent.change(
      await within(properties()).findByLabelText(/Major radius/),
      {
        target: { value: "4.2" },
      },
    );
    await waitFor(() => expect(meshes()).toContain("cmp-pf1:4"), SAVE);
    expect(ifMatch).toEqual(['"3"']);
    expect(meshes()).toContain("cmp-pf2:sha256:pf2-v1");
  });

  it("never replaces a mesh with an older build (D148)", async () => {
    // Replies are cached per fingerprint, so a slow reply for an older one
    // never reaches the view. The case left is a reply under a newer
    // fingerprint that still carries an older build: the merge must drop it.
    const path = `/projects/${P}/geometries/geo-main/tessellation`;
    let stale: GeometryTessellation | undefined;
    let replayStale = false;
    let staleServed = 0;
    const pf1Revision = (tessellation: GeometryTessellation) =>
      tessellation.components.find((c) => c.componentId === "cmp-pf1")!
        .revision;
    server.use(
      http.get(path, () => {
        if (replayStale && stale) {
          staleServed++;
          return HttpResponse.json(toJson(GeometryTessellationSchema, stale));
        }
        const now = store.tessellation(P, "geo-main")!;
        if (pf1Revision(now) === 4) stale ??= now;
        return undefined;
      }),
    );
    await open();
    await waitFor(() => expect(meshes()).toContain("cmp-pf1:3"));
    const seen: number[] = [];
    const viewport = screen.getByTestId("viewport");
    const observer = new MutationObserver(() => {
      const match = /cmp-pf1:(\d+)/.exec(meshes());
      if (match) seen.push(Number(match[1]));
    });
    observer.observe(viewport, { attributes: true });

    await selectInTree(/^PF1/);
    const radius = await within(properties()).findByLabelText(/Major radius/);
    fireEvent.change(radius, { target: { value: "4.0" } });
    await waitFor(() => expect(stale).toBeDefined(), SAVE);
    fireEvent.change(radius, { target: { value: "4.5" } });
    await waitFor(() => expect(meshes()).toContain("cmp-pf1:5"), SAVE);

    // A reply for the renamed geometry's revision still carries revision 4.
    replayStale = true;
    fireEvent.change(geometryName(), {
      target: { value: "Baseline assembly B" },
    });
    await waitFor(() => expect(staleServed).toBeGreaterThan(0), SAVE);
    await waitFor(() =>
      expect(screen.queryByText("Updating…")).not.toBeInTheDocument(),
    );
    expect(meshes()).toContain("cmp-pf1:5");
    observer.disconnect();
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen.at(-1)).toBe(5);
  });

  it("opens the conflict dialog when another client edits the component", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let patches = 0;
    server.use(
      http.patch(`/projects/${P}/components/cmp-pf1`, async () => {
        patches++;
        if (patches === 1) await held;
        return undefined;
      }),
    );
    await open();
    await selectInTree(/^PF1/);
    fireEvent.change(
      await within(properties()).findByLabelText(/Major radius/),
      {
        target: { value: "4.4" },
      },
    );
    await waitFor(() => expect(patches).toBe(1), SAVE);
    scenarios.concurrentEdit(P, EntityKind.COMPONENT, "cmp-pf1");
    release();
    expect(
      await screen.findByRole("dialog", { name: "Edited elsewhere" }),
    ).toBeVisible();
  });

  it("notes that a pinned reference does not show draft edits", async () => {
    await open();
    await selectInTree(/^PF2/);
    const panel = properties();
    expect(
      await within(panel).findByText(
        /This geometry uses pinned version pf2-v1; draft edits appear here once the reference tracks the draft/,
      ),
    ).toBeVisible();
    expect(
      within(panel).getByRole("group", { name: "Reference" }),
    ).toBeVisible();
    expect(
      within(panel).getByRole("radio", { name: "Pinned version" }),
    ).toBeChecked();
  });

  it("saves symmetry edits", async () => {
    await open();
    await selectInTree(/^Symmetry/);
    fireEvent.change(
      await within(properties()).findByLabelText(/Field periods/),
      { target: { value: "2" } },
    );
    await waitFor(
      () => expect(geometryContent().symmetry?.fieldPeriods).toBe(2),
      SAVE,
    );
    expect(geometryContent().symmetry?.axisymmetric).toBe(true);
  });

  it("shows the not-closed issue of the feed circuit (D145)", async () => {
    await open();
    await selectInTree(/^Feed ckt-feed/);
    const issues = await within(properties()).findByRole("list", {
      name: "Circuit issues",
    });
    expect(issues).toHaveTextContent(/Filament circuit "Feed" is not closed/);
    expect(within(properties()).getByLabelText("Circuit ID")).toHaveValue(
      "ckt-feed",
    );
  });

  it("creates a circuit with a stable ID and offers only current-carrying members", async () => {
    await open();
    await userEvent.click(
      within(tree()).getByRole("button", { name: "New circuit" }),
    );
    const created = await within(tree()).findByRole("button", {
      name: /^Circuit 3 /,
    });
    const id = within(created).getByText(/^ckt-/).textContent ?? "";
    expect(id).toMatch(/^ckt-[0-9a-f]{8}$/);
    const panel = properties();
    expect(within(panel).getByLabelText("Circuit ID")).toHaveValue(id);
    expect(within(panel).getByLabelText("Circuit ID")).toHaveAttribute(
      "readonly",
    );

    const add = within(panel).getByRole("button", { name: "Add member" });
    await waitFor(() => expect(add).toBeEnabled());
    await userEvent.click(add);
    const member = within(panel).getByRole("combobox", {
      name: "Member 1 component",
    });
    const offered = within(member)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(offered).toEqual(["PF1", "PF2", "Saddle coil", "Feed lead"]);
    expect(within(panel).getByLabelText("Member 1 turns")).toHaveValue("1");

    await waitFor(
      () =>
        expect(
          geometryContent().circuits.find((circuit) => circuit.id === id)
            ?.members,
        ).toEqual([
          expect.objectContaining({ componentId: "cmp-pf1", turns: 1 }),
        ]),
      SAVE,
    );
  });

  it("rejects zero turns", async () => {
    const patches: string[] = [];
    server.use(
      http.patch(`/projects/${P}/geometries/geo-main`, () => {
        patches.push("patch");
        return undefined;
      }),
    );
    await open();
    await selectInTree(/^PF ckt-pf/);
    const turns = within(properties()).getByLabelText("Member 1 turns");
    fireEvent.change(turns, { target: { value: "0" } });
    expect(within(properties()).getByText(/Must not be 0/)).toBeVisible();
    // 0 never reaches the draft: nothing to save, past the debounce too.
    expect(saveStatus()).toHaveTextContent("Saved");
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(saveStatus()).toHaveTextContent("Saved");
    expect(patches).toEqual([]);
    expect(pfMembers()[0]?.turns).toBe(248);
    fireEvent.change(turns, { target: { value: "-12" } });
    await waitFor(
      () =>
        expect(
          geometryContent().circuits.find((c) => c.id === "ckt-pf")?.members[0]
            ?.turns,
        ).toBe(-12),
      SAVE,
    );
  });

  it("keeps a member's unparsed input with its row when another is removed", async () => {
    await open();
    await selectInTree(/^PF ckt-pf/);
    const panel = properties();
    // Both members are in series group 0; the first's input is cleared.
    fireEvent.change(within(panel).getByLabelText("Member 1 series group"), {
      target: { value: "" },
    });
    expect(within(panel).getByText("Enter a number")).toBeVisible();
    await userEvent.click(
      within(panel).getByRole("button", { name: "Remove member 1" }),
    );
    expect(within(panel).getByLabelText("Member 1 series group")).toHaveValue(
      "0",
    );
    expect(within(panel).queryByText("Enter a number")).not.toBeInTheDocument();
    await waitFor(
      () =>
        expect(pfMembers()).toEqual([
          expect.objectContaining({ componentId: "cmp-pf2", turns: 120 }),
        ]),
      SAVE,
    );
  });

  it("rejects turns and series groups outside their wire range", async () => {
    const patches: string[] = [];
    server.use(
      http.patch(`/projects/${P}/geometries/geo-main`, () => {
        patches.push("patch");
        return undefined;
      }),
    );
    await open();
    await selectInTree(/^PF ckt-pf/);
    const panel = properties();
    // int32 and uint32 (geometry.proto): packing a larger value would throw.
    fireEvent.change(within(panel).getByLabelText("Member 1 turns"), {
      target: { value: "3000000000" },
    });
    expect(within(panel).getByLabelText("Member 1 turns")).toHaveValue(
      "3000000000",
    );
    expect(within(panel).getByLabelText("Member 1 turns")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(within(panel).getByText("Must be at most 2147483647")).toBeVisible();
    fireEvent.change(within(panel).getByLabelText("Member 2 series group"), {
      target: { value: "4294967296" },
    });
    expect(within(panel).getByText("Must be at most 4294967295")).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(saveStatus()).toHaveTextContent("Saved");
    expect(patches).toEqual([]);
  });

  it("keeps keyboard focus when a member or circuit is removed", async () => {
    await open();
    await selectInTree(/^PF ckt-pf/);
    const panel = properties();
    await userEvent.click(
      within(panel).getByRole("button", { name: "Remove member 1" }),
    );
    // The next row's Remove button (now member 1's).
    expect(
      within(panel).getByRole("button", { name: "Remove member 1" }),
    ).toHaveFocus();
    await userEvent.click(
      within(panel).getByRole("button", { name: "Remove member 1" }),
    );
    expect(
      within(panel).getByRole("button", { name: "Add member" }),
    ).toHaveFocus();

    await userEvent.click(
      within(panel).getByRole("button", { name: "Delete circuit" }),
    );
    // The neighbouring circuit's tree row.
    expect(
      within(tree()).getByRole("button", { name: /^Feed ckt-feed/ }),
    ).toHaveFocus();
    await selectInTree(/^Feed ckt-feed/);
    await userEvent.click(
      within(properties()).getByRole("button", { name: "Delete circuit" }),
    );
    expect(
      within(tree()).getByRole("button", { name: "New circuit" }),
    ).toHaveFocus();
  });

  it("adds each component to a circuit at most once", async () => {
    await open();
    await selectInTree(/^Feed ckt-feed/);
    const panel = properties();
    const member = within(panel).getByRole("combobox", {
      name: "Member 1 component",
    });
    // Feed lead is taken by this member; the other eligible ones are free.
    await waitFor(() =>
      expect(within(member).getByRole("option", { name: "PF1" })).toBeEnabled(),
    );
    const add = within(panel).getByRole("button", { name: "Add member" });
    for (let n = 0; n < 3; n++) await userEvent.click(add);
    expect(add).toBeDisabled();
    expect(
      within(panel).getByText(
        "Every current-carrying component is already a member.",
      ),
    ).toBeVisible();
    const second = within(panel).getByRole("combobox", {
      name: "Member 2 component",
    });
    expect(
      within(second).getByRole("option", { name: "Feed lead" }),
    ).toBeDisabled();
  });

  it("shows server violations of a rejected save (Section 5)", async () => {
    server.use(
      http.patch(`/projects/${P}/geometries/geo-main`, () =>
        HttpResponse.json(
          {
            code: "invalid",
            message: "Invalid geometry",
            violations: [
              { path: "name", message: "Name is too long" },
              {
                path: "circuits.0.members.1.turns",
                message: "Too many turns",
              },
            ],
          },
          { status: 422 },
        ),
      ),
    );
    await open();
    fireEvent.change(geometryName(), { target: { value: "Renamed" } });
    const alert = await screen.findByRole("alert", {}, SAVE);
    expect(alert).toHaveTextContent(
      "Circuit “PF”, member 2, turns: Too many turns",
    );
    expect(saveStatus()).toHaveTextContent("Not saved");
    expect(geometryName()).toHaveAttribute("aria-invalid", "true");
    expect(geometryName()).toHaveAccessibleDescription("Name is too long");
  });

  it("applies an add that finishes after another client's save on top of it (D148)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.post(`/projects/${P}/components`, async () => {
        await gate;
        return undefined;
      }),
    );
    await open();
    await userEvent.click(
      within(tree()).getByRole("button", { name: /Add component/ }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "New shape…" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "New shape" });
    await userEvent.selectOptions(
      within(dialog).getByRole("combobox", { name: "Shape" }),
      "Circular filament",
    );
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Name" }),
      "PF9",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create and add" }),
    );
    // Meanwhile another client adds a circuit; the editor refetches it.
    const record = store.entity(P, EntityKind.GEOMETRY, "geo-main")!;
    const theirs = geometryContent();
    store.updateDraft(record, record.draft.revision, {
      name: record.draft.name,
      content: packGeometry({
        ...theirs,
        circuits: [
          ...theirs.circuits,
          create(CircuitSchema, { id: "ckt-other", name: "Other" }),
        ],
      }),
    });
    // (The open dialog hides the tree from role queries.)
    expect(await screen.findByText("ckt-other")).toBeInTheDocument();
    release();

    await waitFor(() => {
      const geometry = geometryContent();
      expect(
        geometry.components.some(
          (ref) =>
            store.entity(P, EntityKind.COMPONENT, ref.id)?.draft.name === "PF9",
        ),
      ).toBe(true);
      expect(geometry.circuits.map((c) => c.id)).toContain("ckt-other");
    }, SAVE);
  });

  it("adds a new core shape as a component", async () => {
    await open();
    await userEvent.click(
      within(tree()).getByRole("button", { name: /Add component/ }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "New shape…" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "New shape" });
    await userEvent.selectOptions(
      within(dialog).getByRole("combobox", { name: "Shape" }),
      "Circular filament",
    );
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Name" }),
      "PF9",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create and add" }),
    );
    expect(
      await within(tree()).findByRole("button", { name: /^PF9 draft/ }),
    ).toBeVisible();
    await waitFor(
      () =>
        expect(
          geometryContent().components.some(
            (ref) =>
              store.entity(P, EntityKind.COMPONENT, ref.id)?.draft.name ===
              "PF9",
          ),
        ).toBe(true),
      SAVE,
    );
  });

  it("adds an existing project component pinned to its head", async () => {
    // Free cmp-pf1 first, then add it back.
    await open();
    await userEvent.click(
      await within(tree()).findByRole("button", {
        name: "Remove PF1 from geometry",
      }),
    );
    expect(
      within(tree()).queryByRole("button", { name: /^PF1/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      within(tree()).getByRole("button", { name: /Add component/ }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Existing component…" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Existing component",
    });
    const select = within(dialog).getByRole("combobox", { name: "Component" });
    await waitFor(() =>
      expect(within(select).getAllByRole("option")).toHaveLength(2),
    );
    await userEvent.selectOptions(select, "PF1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(
      await within(tree()).findByRole("button", {
        name: /^PF1 pinned pf1-v1/,
      }),
    ).toBeVisible();
    await waitFor(() => {
      const ref = geometryContent().components.find((r) => r.id === "cmp-pf1");
      expect(ref?.state.case).toBe("pinned");
      expect(ref?.state.case === "pinned" && ref.state.value.versionHash).toBe(
        store.entity(P, EntityKind.COMPONENT, "cmp-pf1")!.versions[0]!.hash,
      );
    }, SAVE);
    expect(saveStatus()).toHaveTextContent("Saved");
  });

  it("imports a global library component into the geometry", async () => {
    await open();
    await userEvent.click(
      within(tree()).getByRole("button", { name: /Add component/ }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "From global library…" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "From global library",
    });
    const select = within(dialog).getByRole("combobox", {
      name: "Library component",
    });
    await within(select).findByRole("option", { name: "Feed loop" });
    await userEvent.selectOptions(select, "Feed loop");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Import and add" }),
    );
    expect(
      await within(tree()).findByRole("button", { name: /^Feed loop draft/ }),
    ).toBeVisible();
    await waitFor(() => {
      const imported = geometryContent().components.find(
        (ref) =>
          store.entity(P, EntityKind.COMPONENT, ref.id)?.draft.name ===
          "Feed loop",
      );
      expect(imported?.state.case).toBe("draft");
    }, SAVE);
    expect(saveStatus()).toHaveTextContent("Saved");
  });

  it("returns focus to the menu trigger when an add dialog closes", async () => {
    await open();
    const trigger = within(tree()).getByRole("button", {
      name: /Add component/,
    });
    await userEvent.click(trigger);
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Existing component…" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Existing component",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("removes a component from the geometry and its circuits", async () => {
    await open();
    await userEvent.click(
      await within(tree()).findByRole("button", {
        name: "Remove Feed lead from geometry",
      }),
    );
    // Focus moves to the next row, not the document.
    expect(
      within(tree()).getByRole("button", { name: /^Limiter profile/ }),
    ).toHaveFocus();
    await waitFor(() => {
      const geometry = geometryContent();
      expect(geometry.components.map((ref) => ref.id)).not.toContain(
        "cmp-feed",
      );
      expect(
        geometry.circuits.find((c) => c.id === "ckt-feed")?.members,
      ).toEqual([]);
    }, SAVE);
  });

  it("warns when the geometry has no symmetry (D94)", async () => {
    await open("geo-alt");
    const symmetry = within(tree()).getByRole("button", { name: /^Symmetry/ });
    expect(
      await within(symmetry).findByRole("img", { name: "Has errors" }),
    ).toBeVisible();
    await userEvent.click(symmetry);
    expect(
      await within(properties()).findByRole("list", {
        name: "Symmetry issues",
      }),
    ).toBeVisible();
    expect(within(properties()).getByRole("note")).toHaveTextContent(
      /Not set yet/,
    );
  });

  it("shows the draft-vs-head state in the versions", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Versions" }));
    const versions = await screen.findByRole("region", { name: "Versions" });
    expect(
      await within(versions).findByRole("status", { name: "Draft state" }),
    ).toHaveTextContent("Draft changed since head version geo-v2");
    expect(
      within(versions).getByRole("button", { name: "Export STEP geo-v1" }),
    ).toBeVisible();
  });

  it("draws replicas of replicating circuit members, unless turned off", async () => {
    await open();
    await waitFor(() => expect(meshes()).toContain("cmp-pf1:3"));
    expect(replicas()).toBe("");
    await selectInTree(/^Symmetry/);
    fireEvent.change(
      await within(properties()).findByLabelText(/Field periods/),
      { target: { value: "3" } },
    );
    await selectInTree(/^PF ckt-pf/);
    await userEvent.click(
      within(properties()).getByRole("checkbox", {
        name: "Replicate over field periods",
      }),
    );
    // N_fp - 1 replicas of each member.
    await waitFor(() => expect(replicas()).toBe("cmp-pf1:2,cmp-pf2:2"));
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Show symmetry replicas" }),
    );
    expect(replicas()).toBe("");
  });

  it("shows components that could not be built", async () => {
    // Pin PF2 to a version that does not exist.
    const record = store.entity(P, EntityKind.GEOMETRY, "geo-main")!;
    const geometry = geometryContent();
    record.draft.content = packGeometry({
      ...geometry,
      components: geometry.components.map((ref) =>
        ref.id === "cmp-pf2"
          ? componentRef("cmp-pf2", { pinned: "sha256:nope" })
          : ref,
      ),
    });
    await open();
    const alert = await screen.findByText(
      "Some components could not be built:",
    );
    expect(alert.closest("[role=alert]")).toHaveTextContent(
      "PF2: Version sha256:nope not found",
    );
    const pf2 = within(tree()).getByRole("button", { name: /^PF2 / });
    expect(
      within(pf2).getByRole("img", { name: "Has errors" }),
    ).toBeInTheDocument();
    await userEvent.click(pf2);
    expect(
      await within(properties()).findByText(
        "Build failed: Version sha256:nope not found",
      ),
    ).toBeVisible();
  });

  it("reports a failed tessellation request", async () => {
    server.use(
      http.get(`/projects/${P}/geometries/geo-main/tessellation`, () =>
        HttpResponse.json(
          { code: "internal", message: "Worker unavailable" },
          { status: 500 },
        ),
      ),
    );
    await open();
    expect(
      await screen.findByText("Tessellation failed: Worker unavailable"),
    ).toHaveAttribute("role", "alert");
  });

  it("shows a not-found page for an unknown geometry", async () => {
    renderRoute(`/p/${P}/geometry/geo-nope`);
    expect(
      await screen.findByRole("heading", { name: "Geometry not found" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Back to geometries" }),
    ).toHaveAttribute("href", `/p/${P}/geometry`);
  });

  describe("STEP export", () => {
    const names: string[] = [];
    beforeEach(() => {
      names.length = 0;
      URL.createObjectURL = vi.fn(() => "blob:step");
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
        function (this: HTMLAnchorElement) {
          names.push(this.download);
        },
      );
    });
    afterEach(() => vi.restoreAllMocks());

    it("downloads the draft as STEP", async () => {
      await open();
      await userEvent.click(
        screen.getByRole("button", { name: "Export STEP" }),
      );
      await waitFor(() => expect(names).toEqual(["Baseline-assembly.step"]));
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    it("exports the draft only once an edit is saved", async () => {
      const requests: string[] = [];
      server.use(
        http.patch(`/projects/${P}/geometries/geo-main`, () => {
          requests.push("patch");
          return undefined;
        }),
        http.get(`/projects/${P}/geometries/geo-main/step`, () => {
          requests.push("step");
          return undefined;
        }),
      );
      await open();
      const exportButton = screen.getByRole("button", { name: "Export STEP" });
      fireEvent.change(geometryName(), { target: { value: "Renamed" } });
      expect(exportButton).toBeDisabled();
      expect(exportButton).toHaveAccessibleDescription(
        /waits until your edits are saved/,
      );
      await userEvent.click(exportButton);
      expect(requests).toEqual([]);

      await waitFor(() => expect(exportButton).toBeEnabled(), SAVE);
      await userEvent.click(exportButton);
      await waitFor(() => expect(names).toEqual(["Renamed.step"]));
      expect(requests).toEqual(["patch", "step"]);
    });

    it("downloads a version as STEP", async () => {
      await open();
      await userEvent.click(screen.getByRole("button", { name: "Versions" }));
      await userEvent.click(
        await screen.findByRole("button", { name: "Export STEP geo-v2" }),
      );
      await waitFor(() =>
        expect(names).toEqual(["Baseline-assembly-geo-v2.step"]),
      );
    });

    it("reports a failed export", async () => {
      server.use(
        http.get(`/projects/${P}/geometries/geo-main/step`, () =>
          HttpResponse.json(
            { code: "internal", message: "Worker unavailable" },
            { status: 500 },
          ),
        ),
      );
      await open();
      await userEvent.click(
        screen.getByRole("button", { name: "Export STEP" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        /STEP export failed/,
      );
      expect(names).toEqual([]);
    });
  });
});
