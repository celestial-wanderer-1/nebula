import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { store } from "../../mocks/state";
import { renderRoute } from "../../test/render";

describe("Storage (docs/UI.md 6.10, A§4.7)", () => {
  it("evicts derived artifacts", async () => {
    renderRoute("/p/p-baseline/storage");
    const classes = await screen.findByRole("table", {
      name: "Storage by class",
    });
    const meshes = within(classes).getByRole("row", { name: /Meshes/ });
    expect(meshes).toHaveTextContent("2.3 GiB");
    await userEvent.click(
      within(meshes).getByRole("button", { name: "Evict meshes" }),
    );
    await waitFor(() => expect(meshes).toHaveTextContent("0 B"));
    expect(screen.getByRole("status", { name: "Eviction" })).toHaveTextContent(
      "Freed 2.3 GiB",
    );
    // Primary results are never evicted, only deleted.
    expect(
      within(
        within(classes).getByRole("row", { name: /Primary results/ }),
      ).queryByRole("button"),
    ).toBeNull();
  });

  it("lists dependents before deleting primary results (D141)", async () => {
    store.instantiateWorkflow(
      "p-baseline",
      "wft-stored-stability",
      "Uses r-11",
    );
    const record = store
      .entityRecords("p-baseline", 6)
      .find((r) => r.draft.name === "Uses r-11")!;
    const { anyPack, anyUnpack } = await import("@bufbuild/protobuf/wkt");
    const { WorkflowSchema } =
      await import("../../gen/nebula/core/v1/workflow_pb");
    const workflow = anyUnpack(record.draft.content!, WorkflowSchema)!;
    const node = workflow.nodes[0]!;
    if (node.kind.case === "storedOutput") node.kind.value.runId = "r-11";
    record.draft.content = anyPack(WorkflowSchema, workflow);

    renderRoute("/p/p-baseline/storage");
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Delete results of Field to stability #11",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /Delete results of/,
    });
    expect(
      await within(dialog).findByRole("list", { name: "Dependents" }),
    ).toHaveTextContent("Workflow “Uses r-11” nodes/stored (draft)");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete results" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(store.runOutputs("r-11")).toEqual([]);
    expect(
      screen.queryByRole("button", {
        name: "Delete results of Field to stability #11",
      }),
    ).toBeNull();
  });
});
