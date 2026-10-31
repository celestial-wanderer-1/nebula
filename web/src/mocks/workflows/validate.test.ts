import { create } from "@bufbuild/protobuf";
import { anyPack } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { ScenarioSchema } from "../../gen/nebula/core/v1/scenario_pb";
import { WorkflowSchema } from "../../gen/nebula/core/v1/workflow_pb";
import { entityRef } from "../records";
import { chainWorkflow } from "../setupFixtures";
import { store } from "../state";

function validate(
  projectId: string,
  workflow: ReturnType<typeof chainWorkflow>,
  gpus = 0,
) {
  const created = store.createEntity(
    projectId,
    EntityKind.WORKFLOW,
    "w",
    anyPack(WorkflowSchema, create(WorkflowSchema, workflow)),
  );
  if (!created.ok) throw new Error(created.message);
  const result = store.validateWorkflow(
    projectId,
    created.value.draft.id,
    gpus,
  );
  if (!result.ok) throw new Error(result.message);
  return result.value.map((i) => `${i.path} ${i.code}`);
}

const bound = (scenario: string) =>
  chainWorkflow({
    geometry: { id: "geo-main" },
    scenario: { id: scenario },
  });

describe("workflow validation (A§3.4)", () => {
  it("accepts the bound chain in a new tokamak project", () => {
    const project = store.createProject("t", "", "tpl-tokamak")!;
    expect(validate(project.id, bound("scn-flattop"))).toEqual([]);
  });

  it("requires the concept's traits (D64)", () => {
    const project = store.createProject("m", "", "tpl-simple_mirror")!;
    expect(validate(project.id, bound("scn-steady"))).toEqual([
      "nodes/t1 missing_trait",
    ]);
  });

  it("requires the geometry's symmetry traits (D113)", () => {
    const project = store.createProject("s", "", "tpl-stellarator")!;
    expect(validate(project.id, bound("scn-steady"))).toContain(
      "nodes/t1 missing_trait",
    );
  });

  it("checks scenario currents against the geometry's circuits (D114)", () => {
    const project = store.createProject("t", "", "tpl-tokamak")!;
    const scenario = store.entity(
      project.id,
      EntityKind.SCENARIO,
      "scn-flattop",
    )!;
    scenario.draft.content = anyPack(
      ScenarioSchema,
      create(ScenarioSchema, {
        geometry: entityRef(EntityKind.GEOMETRY, "geo-main"),
        currents: [{ circuitId: "ckt-gone", current: 1 }],
      }),
    );
    expect(validate(project.id, bound("scn-flattop"))).toEqual([
      "nodes/field/ports/scenario circuit",
      "nodes/t1/ports/scenario circuit",
    ]);
  });

  it("takes traits of stored outputs from their run's geometry (D22)", () => {
    const workflow = {
      nodes: [
        {
          id: "stored",
          kind: {
            case: "storedOutput" as const,
            value: {
              runId: "r-11",
              nodeId: "t1",
              outputName: "equilibrium",
              contentHash: "sha256:r-11-t1-equilibrium",
              subContract: "Equilibrium.Axisym2D",
            },
          },
        },
        {
          id: "stability",
          kind: {
            case: "solver" as const,
            value: { extensionId: "nebula.stability.local" },
          },
        },
      ],
      edges: [
        {
          id: "e-1",
          from: { nodeId: "stored", port: "output" },
          to: { nodeId: "stability", port: "equilibrium" },
        },
      ],
    };
    expect(validate("p-baseline", workflow)).toEqual([]);
  });

  it("checks GPU and rank counts (D116, A§14.1)", () => {
    const project = store.createProject("t", "", "tpl-tokamak")!;
    expect(validate(project.id, bound("scn-flattop"), 2)).toEqual([]);
    expect(validate(project.id, bound("scn-flattop"), 8)).toEqual([
      "nodes/t1 rank_count",
      " gpus",
    ]);
  });
});
