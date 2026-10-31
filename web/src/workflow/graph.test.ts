import { create } from "@bufbuild/protobuf";
import { toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { EntityKind } from "../gen/nebula/core/v1/entity_pb";
import {
  WorkflowSchema,
  type Workflow,
} from "../gen/nebula/core/v1/workflow_pb";
import { pluginFixtures } from "../mocks/fixtures";
import { entityRef } from "../mocks/records";
import { chainWorkflow } from "../mocks/setupFixtures";
import {
  bindInput,
  connect,
  cyclicEdges,
  disconnect,
  insertAdapter,
  moveNode,
  removeNode,
  structuralIssues,
} from "./graph";
import { indexIssues } from "./issues";
import { extensionIndex } from "./ports";

const extensions = extensionIndex(pluginFixtures());
const chain = () => create(WorkflowSchema, chainWorkflow());
// Every edit must stay encodable: drafts travel packed in an Any.
const encodable = (workflow: Workflow) =>
  expect(() => toBinary(WorkflowSchema, workflow)).not.toThrow();

const codes = (workflow: Workflow) =>
  structuralIssues(workflow, extensions).map((i) => `${i.path} ${i.code}`);

describe("structuralIssues", () => {
  it("reports unbound entity inputs of a template", () => {
    expect(codes(chain())).toEqual([
      "nodes/field/ports/geometry missing_input",
      "nodes/field/ports/scenario missing_input",
      "nodes/t1/ports/scenario missing_input",
    ]);
  });

  it("is clean once required inputs are bound", () => {
    let workflow = chain();
    workflow = bindInput(
      workflow,
      "field",
      "geometry",
      entityRef(EntityKind.GEOMETRY, "g"),
    );
    workflow = bindInput(
      workflow,
      "field",
      "scenario",
      entityRef(EntityKind.SCENARIO, "s"),
    );
    workflow = bindInput(
      workflow,
      "t1",
      "scenario",
      entityRef(EntityKind.SCENARIO, "s"),
    );
    encodable(workflow);
    expect(codes(workflow)).toEqual([]);
  });

  it("reports unconnected inputs, mismatched edges and unknown extensions", () => {
    let workflow = disconnect(chain(), "e-1");
    workflow = connect(
      workflow,
      { nodeId: "field", port: "field" } as never,
      {
        nodeId: "t1",
        port: "field",
      } as never,
    );
    workflow.nodes.push(
      create(WorkflowSchema, {
        nodes: [
          {
            id: "ghost",
            kind: { case: "solver", value: { extensionId: "x.y" } },
          },
        ],
      }).nodes[0]!,
    );
    encodable(workflow);
    const found = codes(workflow);
    expect(found).toContain("nodes/ghost unknown_extension");
    expect(found.find((c) => c.endsWith("port_mismatch"))).toMatch(/^edges\//);
  });

  it("reports an empty workflow", () => {
    expect(codes(create(WorkflowSchema))).toEqual([" empty"]);
  });
});

describe("cycles (D49)", () => {
  const loop = () => {
    const workflow = create(WorkflowSchema, {
      nodes: [
        {
          id: "a",
          kind: {
            case: "solver",
            value: { extensionId: "nebula.equilibrium.t1" },
          },
        },
        {
          id: "b",
          kind: {
            case: "adapter",
            value: { extensionId: "nebula.adapter.flux_coordinates" },
          },
        },
      ],
      edges: [
        {
          id: "e1",
          from: { nodeId: "a", port: "equilibrium" },
          to: { nodeId: "b", port: "equilibrium" },
        },
        {
          id: "e2",
          from: { nodeId: "b", port: "equilibrium" },
          to: { nodeId: "a", port: "field" },
        },
      ],
    });
    return workflow;
  };

  it("flags a cycle outside a coupled group", () => {
    expect([...cyclicEdges(loop())].sort()).toEqual(["e1", "e2"]);
  });

  it("allows a cycle inside a coupled group", () => {
    const workflow = loop();
    workflow.nodes.push(
      create(WorkflowSchema, {
        nodes: [{ id: "c", kind: { case: "coupled", value: {} } }],
      }).nodes[0]!,
    );
    for (const node of workflow.nodes) if (node.id !== "c") node.parentId = "c";
    expect(cyclicEdges(workflow).size).toBe(0);
  });
});

describe("edits", () => {
  it("replaces the edge into an input it connects", () => {
    const workflow = connect(
      chain(),
      { nodeId: "field", port: "operator" } as never,
      {
        nodeId: "t1",
        port: "field",
      } as never,
    );
    expect(workflow.edges.filter((e) => e.to?.nodeId === "t1")).toHaveLength(1);
    encodable(workflow);
  });

  it("inserts an adapter between mismatched ports (D55)", () => {
    const workflow = create(WorkflowSchema, {
      nodes: [
        ...chainWorkflow().nodes!,
        {
          id: "global",
          layout: { x: 900, y: 80 },
          kind: {
            case: "solver",
            value: { extensionId: "nebula.stability.global" },
          },
        },
      ],
    });
    const next = insertAdapter(
      workflow,
      { nodeId: "t1", port: "equilibrium" } as never,
      { nodeId: "global", port: "equilibrium" } as never,
      extensions.get("nebula.adapter.flux_coordinates")!,
      undefined,
    );
    encodable(next);
    const adapter = next.nodes.find((n) => n.kind.case === "adapter")!;
    expect(
      next.edges.map(
        (e) =>
          `${e.from?.nodeId}.${e.from?.port}->${e.to?.nodeId}.${e.to?.port}`,
      ),
    ).toEqual([
      `t1.equilibrium->${adapter.id}.equilibrium`,
      `${adapter.id}.equilibrium->global.equilibrium`,
    ]);
  });

  it("removes a group with its children and their edges", () => {
    const workflow = chain();
    workflow.nodes.push(
      create(WorkflowSchema, {
        nodes: [{ id: "g", kind: { case: "coupled", value: {} } }],
      }).nodes[0]!,
    );
    workflow.nodes.find((n) => n.id === "t1")!.parentId = "g";
    const next = removeNode(workflow, "g");
    expect(next.nodes.map((n) => n.id)).toEqual(["field", "stability"]);
    expect(next.edges).toEqual([]);
  });

  it("moves nodes with encodable layouts", () => {
    const next = moveNode(
      create(WorkflowSchema, { nodes: [{ id: "n" }] }),
      "n",
      { x: 3, y: 4 },
    );
    encodable(next);
    expect(next.nodes[0]?.layout).toMatchObject({ x: 3, y: 4 });
  });
});

describe("indexIssues", () => {
  it("indexes issues by node, port and edge", () => {
    const index = indexIssues(structuralIssues(chain(), extensions));
    expect(index.nodes.get("field")).toHaveLength(2);
    expect(index.ports.get("t1/scenario")).toHaveLength(1);
    expect(index.general).toEqual([]);
  });
});
