import { anyUnpack } from "@bufbuild/protobuf/wkt";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { WorkflowSchema } from "../../gen/nebula/core/v1/workflow_pb";
import { store } from "../../mocks/state";
import { renderRoute } from "../../test/render";
import type { FlowCanvasProps } from "./FlowCanvas";
import { resetWorkflowView, useWorkflowView } from "./store";

// React Flow needs layout APIs jsdom lacks; the canvas is replaced by a
// list that exposes what it would draw.
vi.mock("./FlowCanvas", () => ({
  FlowCanvas: ({ workflow, issues }: FlowCanvasProps) => (
    <ul data-testid="flow-canvas">
      {workflow.nodes.map((node) => (
        <li
          key={node.id}
          data-node={node.id}
          data-issues={issues.nodes.get(node.id)?.length ?? 0}
        >
          {node.label}
        </li>
      ))}
      {workflow.edges.map((edge) => (
        <li
          key={edge.id}
          data-edge={`${edge.from?.nodeId}.${edge.from?.port}->${edge.to?.nodeId}.${edge.to?.port}`}
        />
      ))}
    </ul>
  ),
}));

beforeEach(() => resetWorkflowView());

const P = "p-baseline";

function savedWorkflow(id: string) {
  const record = store.entity(P, EntityKind.WORKFLOW, id)!;
  return anyUnpack(record.draft.content!, WorkflowSchema)!;
}

async function newWorkflow(name: string) {
  renderRoute(`/p/${P}/workflows`);
  await userEvent.click(
    await screen.findByRole("button", { name: "New workflow" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "New workflow" });
  await userEvent.type(
    within(dialog).getByRole("textbox", { name: "Name" }),
    name,
  );
  const submit = within(dialog).getByRole("button", {
    name: "Create workflow",
  });
  await waitFor(() => expect(submit).toBeEnabled());
  await userEvent.click(submit);
  expect(await screen.findByRole("heading", { name, level: 1 })).toBeVisible();
  return store
    .entityRecords(P, EntityKind.WORKFLOW)
    .find((r) => r.draft.name === name)!.draft.id;
}

describe("WorkflowEditor", () => {
  it("adds a step from the palette and binds its entity inputs (D107)", async () => {
    const id = await newWorkflow("Field only");
    const palette = await screen.findByRole("navigation", { name: "Palette" });
    await userEvent.click(
      within(palette).getByRole("button", { name: "Biot–Savart field" }),
    );
    const node = await screen.findByRole("region", {
      name: "Node Biot–Savart field",
    });
    const geometry = within(node).getByRole("group", { name: "geometry" });
    const select = within(geometry).getByLabelText("Geometry");
    await waitFor(() =>
      expect(within(select).getByText("Baseline assembly")).toBeInTheDocument(),
    );
    await userEvent.selectOptions(select, "geo-main");
    expect(
      within(node).getByRole("button", { name: "Unbind geometry" }),
    ).toBeVisible();
    await waitFor(
      () =>
        expect(savedWorkflow(id).nodes[0]?.kind.value).toMatchObject({
          extensionId: "nebula.field.biot_savart",
          bindings: [{ port: "geometry", ref: { id: "geo-main" } }],
        }),
      { timeout: 3000 },
    );
  });

  it("creates a workflow from the concept's default template (D86)", async () => {
    const { router } = renderRoute(`/p/${P}/workflows`);
    await userEvent.click(
      await screen.findByRole("button", { name: "From template" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "New workflow from a template",
    });
    await userEvent.click(
      await within(dialog).findByRole("radio", { name: /Tokamak default/ }),
    );
    expect(within(dialog).queryByRole("radio", { name: /mirror/i })).toBeNull();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create workflow" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Tokamak default", level: 1 }),
    ).toBeVisible();
    const id = router.state.location.pathname.split("/").pop()!;
    expect(savedWorkflow(id).nodes.map((n) => n.id)).toEqual([
      "field",
      "t1",
      "flux",
      "stability",
    ]);
    expect(
      screen.getByTestId("flow-canvas").querySelectorAll("[data-edge]"),
    ).toHaveLength(3);
  });

  it("offers an adapter for a sub-contract mismatch (D55)", async () => {
    renderRoute(`/p/${P}/workflows/wf-chain`);
    const palette = await screen.findByRole("navigation", { name: "Palette" });
    await userEvent.click(
      within(palette).getByRole("button", { name: "Global stability" }),
    );
    const node = await screen.findByRole("region", {
      name: "Node Global stability",
    });
    const connectFrom = within(node).getByLabelText("Connect equilibrium from");
    const options = within(connectFrom).getAllByRole("option");
    expect(
      options.find((o) =>
        o.textContent?.startsWith("Biot–Savart field · field"),
      ),
    ).toBeDisabled();
    await userEvent.selectOptions(connectFrom, "t1\u0000equilibrium");
    const offer = await screen.findByRole("dialog", {
      name: "Insert an adapter",
    });
    expect(offer).toHaveTextContent(
      "Equilibrium.Axisym2D does not match Equilibrium.FluxCoordinates",
    );
    await userEvent.click(
      within(offer).getByRole("button", { name: "Insert Demo upsampler" }),
    );
    await waitFor(
      () => {
        const workflow = savedWorkflow("wf-chain");
        const adapter = workflow.nodes.find((n) => n.kind.case === "adapter");
        expect(adapter?.kind.value).toMatchObject({
          extensionId: "acme.demo.upsample",
          // A plugin adapter starts with its config message's defaults.
          config: {
            typeUrl: "type.googleapis.com/acme.demo.v1.DemoAdapterConfig",
          },
        });
        expect(workflow.edges).toHaveLength(4);
      },
      { timeout: 3000 },
    );
  });

  it("shows the server's validation issues on their nodes", async () => {
    renderRoute(`/p/${P}/workflows/wf-chain`);
    const validate = await screen.findByRole("button", { name: "Validate" });
    await userEvent.click(validate);
    const result = await screen.findByRole("region", { name: "Validation" });
    expect(within(result).getByRole("status")).toHaveTextContent(
      "1 issue to fix before a run.",
    );
    expect(result).toHaveTextContent("Geometry: Filament circuit");
    expect(
      screen.getByTestId("flow-canvas").querySelector('[data-node="field"]'),
    ).toHaveAttribute("data-issues", "1");
    await userEvent.click(
      within(result).getByRole("button", { name: "Biot–Savart field" }),
    );
    const node = screen.getByRole("region", { name: "Node Biot–Savart field" });
    expect(
      within(node).getByRole("list", { name: "Issues of geometry" }),
    ).toBeVisible();
  });

  it("feeds a stored output into a step (D22)", async () => {
    const id = await newWorkflow("Restability");
    const palette = screen.getByRole("navigation", { name: "Palette" });
    await userEvent.click(
      within(palette).getByRole("button", { name: "Stored output" }),
    );
    const stored = await screen.findByRole("region", {
      name: "Node Stored output",
    });
    const run = within(stored).getByLabelText("Run");
    await waitFor(() =>
      expect(
        within(run).getByText("Field to stability #11"),
      ).toBeInTheDocument(),
    );
    await userEvent.selectOptions(run, "r-11");
    const output = within(stored).getByLabelText("Output", {
      selector: "select",
    });
    await waitFor(() =>
      expect(within(output).getAllByRole("option").length).toBe(6),
    );
    await userEvent.selectOptions(output, "t1/equilibrium");
    expect(stored).toHaveTextContent("Pinned to");

    await userEvent.click(
      within(palette).getByRole("button", { name: "Local stability" }),
    );
    const stability = await screen.findByRole("region", {
      name: "Node Local stability",
    });
    await userEvent.selectOptions(
      within(stability).getByLabelText("Connect equilibrium from"),
      "stored-output-1\u0000output",
    );
    expect(
      within(stability).getByText(/From Stored output · output/),
    ).toBeVisible();
    await waitFor(
      () =>
        expect(savedWorkflow(id).edges[0]).toMatchObject({
          from: { nodeId: "stored-output-1", port: "output" },
          to: { port: "equilibrium" },
        }),
      { timeout: 3000 },
    );
  });

  it("nests steps in a coupled node and removes them with it (D49)", async () => {
    const id = await newWorkflow("Coupled");
    const palette = screen.getByRole("navigation", { name: "Palette" });
    await userEvent.click(
      within(palette).getByRole("button", { name: "Coupled" }),
    );
    const coupled = await screen.findByRole("region", { name: "Node Coupled" });
    expect(within(coupled).getByLabelText("Tolerance")).toHaveValue("0.000001");
    await userEvent.click(
      within(palette).getByRole("button", { name: "T1 equilibrium" }),
    );
    const t1 = await screen.findByRole("region", {
      name: "Node T1 equilibrium",
    });
    await userEvent.selectOptions(
      within(t1).getByLabelText("Inside"),
      "coupled-1",
    );
    await waitFor(
      () => expect(savedWorkflow(id).nodes[1]?.parentId).toBe("coupled-1"),
      { timeout: 3000 },
    );
    await userEvent.click(
      within(palette).getByRole("button", { name: "Coupled" }),
    );
    await screen.findByRole("region", { name: "Node Coupled" });
    // Select the first coupled node again through the node list.
    useWorkflowView.getState().select(id, "coupled-1");
    await userEvent.click(
      await screen.findByRole("button", { name: "Remove node" }),
    );
    await waitFor(
      () =>
        expect(savedWorkflow(id).nodes.map((n) => n.id)).toEqual(["coupled-2"]),
      { timeout: 3000 },
    );
  });
});
