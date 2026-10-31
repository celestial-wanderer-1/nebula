import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { EntityKind } from "../gen/nebula/core/v1/entity_pb";
import { PortTypeSchema } from "../gen/nebula/core/v1/plugin_pb";
import { WorkflowSchema } from "../gen/nebula/core/v1/workflow_pb";
import { pluginFixtures } from "../mocks/fixtures";
import {
  chainWorkflow,
  workflowTemplateFixtures,
} from "../mocks/setupFixtures";
import {
  adaptersFor,
  checkConnection,
  compatible,
  describeType,
  extensionIndex,
  nodePorts,
} from "./ports";

const extensions = extensionIndex(pluginFixtures());
const type = (subContract: string, timeSeries = false) =>
  create(PortTypeSchema, {
    type: { case: "subContract", value: subContract },
    timeSeries,
  });

describe("compatible (D55, D92)", () => {
  it("accepts equal sub-contracts", () => {
    expect(compatible(type("A.B"), type("A.B"))).toEqual({ ok: true });
  });

  it("refuses different sub-contracts", () => {
    expect(compatible(type("A.B"), type("A.C"))).toMatchObject({
      ok: false,
      code: "port_mismatch",
      message: "A.B does not match A.C",
    });
  });

  it("refuses a time series into a plain input outside a fan-out", () => {
    expect(compatible(type("A.B", true), type("A.B"))).toMatchObject({
      ok: false,
      code: "time_series",
    });
    expect(compatible(type("A.B", true), type("A.B"), true)).toEqual({
      ok: true,
    });
    expect(compatible(type("A.B"), type("A.B", true))).toMatchObject({
      ok: false,
      code: "time_series",
    });
  });

  it("describes entity and time-series types", () => {
    expect(describeType(type("A.B", true))).toBe("A.B (time series)");
    expect(
      describeType(
        create(PortTypeSchema, {
          type: { case: "entity", value: EntityKind.GEOMETRY },
        }),
      ),
    ).toBe("GEOMETRY reference");
  });
});

describe("adaptersFor", () => {
  it("finds the adapters between two sub-contracts, core and plugin", () => {
    const found = adaptersFor(
      type("Equilibrium.Axisym2D"),
      type("Equilibrium.FluxCoordinates"),
      extensions.values(),
    ).map((e) => e.id);
    expect(found).toEqual([
      "nebula.adapter.flux_coordinates",
      "acme.demo.upsample",
    ]);
    expect(
      adaptersFor(
        type("Stability.Spectrum"),
        type("Equilibrium.Axisym2D"),
        extensions.values(),
      ),
    ).toEqual([]);
  });
});

describe("nodePorts", () => {
  const workflow = create(WorkflowSchema, chainWorkflow());

  it("splits a step's entity inputs from its data inputs", () => {
    const field = workflow.nodes.find((n) => n.id === "field")!;
    const ports = nodePorts(workflow, field, extensions);
    expect(ports.bindings.map((p) => p.name)).toEqual([
      "geometry",
      "scenario",
      "region",
    ]);
    expect(ports.inputs).toEqual([]);
    expect(ports.outputs.map((p) => p.name)).toEqual(["field", "operator"]);
  });

  it("makes outputs time series inside a fan-out (D92)", () => {
    const template = workflowTemplateFixtures().find(
      (t) => t.id === "wft-transport",
    )!;
    const stability = template.workflow!.nodes.find(
      (n) => n.id === "stability",
    )!;
    const ports = nodePorts(template.workflow!, stability, extensions);
    expect(ports.outputs[0]?.type.timeSeries).toBe(true);
  });

  it("gives stored outputs one port of their sub-contract", () => {
    const template = workflowTemplateFixtures().find(
      (t) => t.id === "wft-stored-stability",
    )!;
    const stored = template.workflow!.nodes.find((n) => n.id === "stored")!;
    expect(
      nodePorts(template.workflow!, stored, extensions).outputs,
    ).toMatchObject([
      { name: "output", type: { type: { value: "Equilibrium.Axisym2D" } } },
    ]);
  });
});

describe("checkConnection", () => {
  const workflow = create(WorkflowSchema, {
    nodes: [
      ...chainWorkflow().nodes!,
      {
        id: "global",
        kind: {
          case: "solver",
          value: { extensionId: "nebula.stability.global" },
        },
      },
    ],
  });

  it("accepts matching ports", () => {
    expect(
      checkConnection(
        workflow,
        extensions,
        { nodeId: "field", port: "operator" },
        { nodeId: "t1", port: "field" },
      ),
    ).toEqual({ status: "ok" });
  });

  it("offers adapters for a sub-contract mismatch", () => {
    const check = checkConnection(
      workflow,
      extensions,
      { nodeId: "t1", port: "equilibrium" },
      { nodeId: "global", port: "equilibrium" },
    );
    expect(check.status).toBe("adapter");
    expect(check.status === "adapter" && check.adapters).toHaveLength(2);
  });

  it("blocks what no adapter converts, and self-loops", () => {
    expect(
      checkConnection(
        workflow,
        extensions,
        { nodeId: "field", port: "field" },
        { nodeId: "t1", port: "field" },
      ),
    ).toMatchObject({ status: "blocked" });
    expect(
      checkConnection(
        workflow,
        extensions,
        { nodeId: "t1", port: "equilibrium" },
        { nodeId: "t1", port: "field" },
      ),
    ).toMatchObject({
      status: "blocked",
      message: "A node cannot feed itself",
    });
  });
});
