import { create } from "@bufbuild/protobuf";
import { anyPack, anyUnpack } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { RunState } from "../gen/nebula/core/v1/run_pb";
import { StorageClass } from "../gen/nebula/core/v1/storage_pb";
import {
  StudyState,
  StudyVariableSchema,
} from "../gen/nebula/core/v1/study_pb";
import { WorkflowSchema } from "../gen/nebula/core/v1/workflow_pb";
import { MockClock } from "./clock";
import { MockStore } from "./store";
import { cartesian } from "./studies";

const P = "p-baseline";
const newStore = () =>
  new MockStore("1", new MockClock({ mode: "manual", start: 0 }));

describe("comparisons (D104, D43)", () => {
  it("flags quantities beyond their declared tolerance", () => {
    const store = newStore();
    const result = store.comparisons.create(P, { runIds: ["r-11", "r-03"] });
    if (!result.ok) throw new Error(result.message);
    const rows = result.value.scalars;
    expect(rows.filter((r) => r.outOfTolerance).map((r) => r.quantity)).toEqual(
      ["q95"],
    );
    const q95 = rows.find((r) => r.quantity === "q95")!;
    expect(q95.cells.map((c) => c.value)).toEqual([3.31, 3.02]);
    expect(q95.maxRelDiff).toBeCloseTo(0.0876, 3);
    expect(result.value.outputs.map((o) => o.key)).toEqual([
      "field/field",
      "t1/equilibrium",
      "t1/lcfs",
      "stability/growth_rates",
    ]);
    expect(store.comparisons.list(P)).toHaveLength(1);
  });

  it("compares at least two Runs of one project (D51)", () => {
    const store = newStore();
    expect(store.comparisons.create(P, { runIds: ["r-11"] })).toMatchObject({
      ok: false,
    });
    expect(
      store.comparisons.create(P, { runIds: ["r-11", "r-b1"] }),
    ).toMatchObject({ ok: false });
  });
});

describe("scan studies (A§12.4, D109, D142)", () => {
  const variable = (path: string, values: number[]) =>
    create(StudyVariableSchema, {
      path,
      values: { case: "points", value: { values } },
    });

  it("forms the cartesian product of the variables", () => {
    expect(
      cartesian([
        variable("a", [1, 2]),
        create(StudyVariableSchema, {
          path: "b",
          values: { case: "range", value: { min: 0, max: 1, count: 3 } },
        }),
      ]),
    ).toEqual([
      { a: 1, b: 0 },
      { a: 1, b: 0.5 },
      { a: 1, b: 1 },
      { a: 2, b: 0 },
      { a: 2, b: 0.5 },
      { a: 2, b: 1 },
    ]);
  });

  it("runs one point Run per override vector, at most `concurrency` at once", () => {
    const store = newStore();
    const created = store.studies.create(P, {
      name: "Scan",
      workflowId: "wf-chain",
      workflowVersionHash: "sha256:wf-v2",
      variables: [
        variable(
          "scenarios/scn-flattop/currents/ckt-pf/current",
          [4e4, 4.6e4, 5.2e4],
        ),
        variable("nodes/t1/config/tolerance", [1e-6, 1e-8]),
      ],
      concurrency: 2,
      gpusPerRun: 1,
      mode: 0,
    });
    if (!created.ok) throw new Error(created.message);
    const study = created.value;
    expect(study.points).toHaveLength(6);
    store.studies.start(P, study.id);
    const active = () =>
      study.points.filter(
        (p) =>
          p.runId &&
          ![RunState.COMPLETED, RunState.FAILED, RunState.CANCELLED].includes(
            p.state,
          ),
      ).length;
    let peak = 0;
    store.clock.advanceUntil(() => {
      peak = Math.max(peak, active());
      return study.state === StudyState.COMPLETED;
    });
    expect(peak).toBe(2);
    expect(study.points.every((p) => p.state === RunState.COMPLETED)).toBe(
      true,
    );
    // Each point's Run carries its overrides, and its q95 follows the coil current.
    const run = store.engine.run(study.points[0]!.runId)!;
    expect(run.studyId).toBe(study.id);
    expect(run.overrides?.values["nodes/t1/config/tolerance"]).toBe(1e-6);
    const q95 = (i: number) => study.points[i]!.metrics.q95!;
    expect(q95(0)).toBeLessThan(q95(4));
  });

  it("requires a pinned base version (D109)", () => {
    const store = newStore();
    expect(
      store.studies.create(P, {
        name: "",
        workflowId: "wf-chain",
        workflowVersionHash: "sha256:nope",
        variables: [variable("x", [1])],
        concurrency: 0,
        gpusPerRun: 0,
        mode: 0,
      }),
    ).toMatchObject({ ok: false, status: 422 });
  });
});

describe("storage (A§4.7, D79, D141)", () => {
  it("reports usage by class and evicts derived artifacts", () => {
    const store = newStore();
    const usage = store.storage.usage(P)!;
    const bytes = (cls: StorageClass) =>
      store.storage.usage(P)!.categories.find((c) => c.storageClass === cls)!
        .bytes;
    expect(usage.usedBytes).toBeGreaterThan(0n);
    expect(usage.results.map((r) => r.runId)).toEqual(["r-14", "r-11", "r-03"]);
    expect(bytes(StorageClass.MESHES)).toBeGreaterThan(0n);
    const evicted = store.storage.evict(P, [StorageClass.MESHES]);
    expect(evicted.ok && evicted.value).toBeGreaterThan(0n);
    expect(bytes(StorageClass.MESHES)).toBe(0n);
    expect(store.storage.evict(P, [StorageClass.PRIMARY])).toMatchObject({
      ok: false,
    });
  });

  it("deletes primary results only after acknowledging dependents", () => {
    const store = newStore();
    // A stored-output node feeds r-11's equilibrium into a workflow.
    const created = store.instantiateWorkflow(
      P,
      "wft-stored-stability",
      "Stored",
    );
    if (!created.ok) throw new Error(created.message);
    const record = created.value;
    const workflow = anyUnpack(record.draft.content!, WorkflowSchema)!;
    const stored = workflow.nodes[0]!;
    if (stored.kind.case === "storedOutput") stored.kind.value.runId = "r-11";
    record.draft.content = anyPack(WorkflowSchema, workflow);
    expect(store.storage.dependents(P, "r-11")).toEqual([
      expect.objectContaining({ id: record.draft.id, path: "nodes/stored" }),
    ]);
    expect(store.storage.deleteResults(P, ["r-11"], false)).toMatchObject({
      ok: false,
      code: "in_use",
    });
    expect(store.storage.deleteResults(P, ["r-11"], true)).toMatchObject({
      ok: true,
    });
    expect(store.runOutputs("r-11")).toEqual([]);
    // The Run's record stays (A§4.7).
    expect(store.run(P, "r-11")?.state).toBe(RunState.COMPLETED);
  });
});
