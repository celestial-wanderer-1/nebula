import { create } from "@bufbuild/protobuf";
import { anyPack, anyUnpack } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { EntityKind } from "../gen/nebula/core/v1/entity_pb";
import { WorkflowSchema } from "../gen/nebula/core/v1/workflow_pb";
import { mockSchema } from "../mocks/fixtures";
import { MockStore } from "../mocks/store";
import { designVariables } from "./designVariables";

describe("designVariables (D81)", () => {
  const store = new MockStore("1");
  const record = store.entity("p-baseline", EntityKind.WORKFLOW, "wf-chain")!;
  const workflow = anyUnpack(
    record.versionContents!["sha256:wf-v2"]!,
    WorkflowSchema,
  )!;
  const resolve = (ref: Parameters<typeof store.resolve>[1]) =>
    store.resolve("p-baseline", ref);

  it("offers bound scenario currents and plasma targets, and component shapes", () => {
    const variables = designVariables(
      workflow,
      resolve,
      mockSchema.typeRegistry,
      new Map([["ckt-pf", "PF"]]),
    );
    const paths = variables.map((v) => v.path);
    expect(paths).toContain("scenarios/scn-flattop/currents/ckt-pf/current");
    expect(paths).toContain(
      "scenarios/scn-flattop/plasma_targets/0/plasma_current",
    );
    expect(paths).toContain("components/cmp-pf1/shape/major_radius");
    // Only design-variable fields: segments is not one.
    expect(paths.some((p) => p.endsWith("/segments"))).toBe(false);
    expect(
      variables.find((v) => v.path.endsWith("ckt-pf/current")),
    ).toMatchObject({
      label: "Current of PF",
      unit: "A",
      value: 46000,
    });
  });

  it("offers design variables of a plugin step config", () => {
    const demo = mockSchema.getMessage("acme.demo.v1.DemoSolverConfig")!;
    const config = anyPack(demo, create(demo, { coilCurrent: 1200 } as never));
    const withPlugin = create(WorkflowSchema, {
      nodes: [
        {
          id: "demo",
          label: "Demo",
          kind: {
            case: "solver",
            value: { extensionId: "acme.demo.solver", config },
          },
        },
      ],
    });
    expect(
      designVariables(withPlugin, resolve, mockSchema.typeRegistry),
    ).toEqual([
      expect.objectContaining({
        path: "nodes/demo/config/coil_current",
        label: "Demo: Coil current",
        unit: "A",
        value: 1200,
        min: -1e7,
        max: 1e7,
      }),
    ]);
  });
});
