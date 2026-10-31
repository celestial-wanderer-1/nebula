import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import {
  DeterminismMode,
  FailureReason,
  ProvenanceTag,
  RerunInputs,
  RunAction,
  RunState,
  StepState,
  type Run,
} from "../../gen/nebula/core/v1/run_pb";
import { WorkflowSchema } from "../../gen/nebula/core/v1/workflow_pb";
import { MockClock } from "../clock";
import { chainWorkflow } from "../setupFixtures";
import { MockStore } from "../store";
import { RUN_SCRIPTS, type RunScriptName } from "./scripts";
import { rerun, submitRun } from "./service";

function setup() {
  const store = new MockStore("1", new MockClock({ mode: "manual", start: 0 }));
  const project = store.createProject("Engine", "", "tpl-tokamak")!;
  const workflowId = "wf-default";
  return { store, p: project.id, workflowId };
}

function submit(
  store: MockStore,
  projectId: string,
  workflowId: string,
  options: {
    gpus?: number;
    mode?: DeterminismMode;
    script?: RunScriptName;
  } = {},
): Run {
  if (options.script) store.engine.scriptNextRun(options.script);
  const result = submitRun(store, projectId, {
    workflowId,
    gpus: options.gpus ?? 0,
    mode: options.mode ?? DeterminismMode.DETERMINISTIC,
    dryRun: false,
    name: "",
    rerunOf: "",
  });
  if (!result.ok) throw new Error(result.message);
  if (!result.value.run) {
    throw new Error(result.value.issues.map((i) => i.message).join("; "));
  }
  return result.value.run;
}

const until = (store: MockStore, run: Run, state: RunState) =>
  store.clock.advanceUntil(() => run.state === state);

describe("run lifecycle (A§3.4, A§14.1)", () => {
  it("queues, prepares, runs and completes, committing outputs per step", () => {
    const { store, p, workflowId } = setup();
    const run = submit(store, p, workflowId);
    expect(run.state).toBe(RunState.QUEUED);
    expect(run.attempts).toHaveLength(1);
    until(store, run, RunState.PREPARING);
    until(store, run, RunState.RUNNING);
    expect(run.gpuIndices).toHaveLength(run.gpus);
    // r-12 holds GPU 0, so the new Run gets the next free ones.
    expect(run.gpuIndices).not.toContain(0);
    until(store, run, RunState.COMPLETED);
    expect(run.steps.map((s) => s.state)).toEqual(
      run.steps.map(() => StepState.COMPLETED),
    );
    const outputs = store
      .runOutputs(run.id)
      .map((o) => `${o.nodeId}.${o.name}`);
    expect(outputs).toEqual([
      "field.field",
      "field.operator",
      "t1.equilibrium",
      "t1.lcfs",
      "t1.scalars",
      "flux.equilibrium",
      "stability.modes",
      "stability.growth_rates",
    ]);
    expect(run.attempts[0]).toMatchObject({
      state: RunState.COMPLETED,
      hasCheckpoint: true,
      checkpointEpoch: 4,
      hardware: { gpuModel: "MI300X" },
    });
    expect(store.engine.gpuAssignments().filter(Boolean)).toEqual(["r-12"]);
  });

  it("completes an unchanged resubmission from the cache at once", () => {
    const { store, p, workflowId } = setup();
    const first = submit(store, p, workflowId);
    until(store, first, RunState.COMPLETED);
    const second = submit(store, p, workflowId);
    expect(second.state).toBe(RunState.COMPLETED);
    expect(second.cacheHit).toBe(true);
    expect(second.attempts).toEqual([]);
    expect(second.steps.every((s) => s.cacheProducerRunId === first.id)).toBe(
      true,
    );
    expect(store.runOutputs(second.id)[0]?.producerRunId).toBe(first.id);
    // Fast mode is another cache key (D77).
    const fast = submit(store, p, workflowId, { mode: DeterminismMode.FAST });
    expect(fast.state).toBe(RunState.QUEUED);
  });

  it("mints the drafts it reaches and pins them (A§4.2)", () => {
    const { store, p, workflowId } = setup();
    const preview = submitRun(store, p, {
      workflowId,
      gpus: 0,
      mode: DeterminismMode.DETERMINISTIC,
      dryRun: true,
      name: "",
      rerunOf: "",
    });
    expect(preview.ok && preview.value.run).toBeUndefined();
    const minted = preview.ok
      ? preview.value.minted.map((d) => EntityKind[d.kind])
      : [];
    // Dependencies first: components, then the geometry, then the rest.
    expect(minted.indexOf("COMPONENT")).toBeLessThan(
      minted.indexOf("GEOMETRY"),
    );
    expect(minted.at(-1)).toBe("WORKFLOW");
    expect(store.entity(p, EntityKind.GEOMETRY, "geo-main")!.versions).toEqual(
      [],
    );

    const run = submit(store, p, workflowId);
    const geometry = store.entity(p, EntityKind.GEOMETRY, "geo-main")!;
    expect(geometry.versions[0]).toMatchObject({ sourceId: run.id });
    expect(run.provenance?.inputs.map((i) => EntityKind[i.kind])).toContain(
      "GEOMETRY",
    );
    // Nothing changed: the next submission reuses every version.
    const again = submitRun(store, p, {
      workflowId,
      gpus: 0,
      mode: DeterminismMode.DETERMINISTIC,
      dryRun: true,
      name: "",
      rerunOf: "",
    });
    expect(again.ok && again.value.minted.every((d) => d.reusesVersion)).toBe(
      true,
    );
  });

  it("defaults the GPU count from the manifests and bounds it (D102, D116)", () => {
    const { store, p, workflowId } = setup();
    const preview = submitRun(store, p, {
      workflowId,
      gpus: 3,
      mode: DeterminismMode.DETERMINISTIC,
      dryRun: true,
      name: "",
      rerunOf: "",
    });
    if (!preview.ok) throw new Error();
    // Global stability hints 2 GPUs; T1 and global stability run on 1, 2 or 4.
    expect(preview.value.defaultGpus).toBe(2);
    expect(preview.value.allowedGpus).toEqual([1, 2, 4]);
    expect(preview.value.issues.map((i) => i.code)).toContain("rank_count");
  });
});

describe("failures and resume (A§3.7)", () => {
  it("resumes an oom failure from its checkpoint as a new attempt", () => {
    const { store, p, workflowId } = setup();
    const run = submit(store, p, workflowId, { script: "oom" });
    until(store, run, RunState.FAILED);
    expect(run.attempts[0]).toMatchObject({
      failure: FailureReason.OOM,
      hasCheckpoint: true,
      failedStep: "t1",
      failedRank: 0,
    });
    expect(store.engine.action(run.id, RunAction.RESUME).ok).toBe(true);
    // Prepared already and GPUs free: it starts at once.
    expect(run.state).toBe(RunState.RUNNING);
    until(store, run, RunState.COMPLETED);
    expect(run.attempts.map((a) => a.state)).toEqual([
      RunState.FAILED,
      RunState.COMPLETED,
    ]);
    // The resumed attempt did not redo the checkpointed field step.
    expect(
      store.runOutputs(run.id).filter((o) => o.nodeId === "field"),
    ).toHaveLength(2);
  });

  it("offers no resume after a non-transient failure", () => {
    const { store, p, workflowId } = setup();
    const run = submit(store, p, workflowId, { script: "diverged" });
    until(store, run, RunState.FAILED);
    expect(run.attempts[0]?.failure).toBe(FailureReason.DIVERGED);
    expect(store.engine.action(run.id, RunAction.RESUME)).toMatchObject({
      ok: false,
    });
    expect(store.engine.action(run.id, RunAction.DISCARD).ok).toBe(true);
    expect(run.state).toBe(RunState.DISCARDED);
  });

  it("offers no resume without a checkpoint", () => {
    const { store, p, workflowId } = setup();
    const run = submit(store, p, workflowId, { script: "crashed" });
    until(store, run, RunState.FAILED);
    expect(run.attempts[0]).toMatchObject({
      failure: FailureReason.CRASHED,
      hasCheckpoint: false,
    });
    expect(store.engine.action(run.id, RunAction.RESUME).ok).toBe(false);
  });

  it("fails in Preparing with geometry_failed and holds no GPU (D121)", () => {
    const { store, p, workflowId } = setup();
    const run = submit(store, p, workflowId, { script: "geometry_failed" });
    until(store, run, RunState.FAILED);
    expect(run.attempts[0]?.failure).toBe(FailureReason.GEOMETRY_FAILED);
    expect(run.attempts[0]?.hardware).toBeUndefined();
  });

  it("resumes a supervisor_lost Run and tags mixed builds (D130)", () => {
    const { store, p, workflowId } = setup();
    const run = submit(store, p, workflowId, { script: "supervisor_lost" });
    until(store, run, RunState.FAILED);
    store.engineBuild = "build-2026.11.0";
    store.engine.action(run.id, RunAction.RESUME);
    until(store, run, RunState.COMPLETED);
    expect(run.tags).toContain(ProvenanceTag.MIXED_BUILDS);
  });

  it("pauses after a checkpoint, releases GPUs and resumes", () => {
    const { store, p, workflowId } = setup();
    const run = submit(store, p, workflowId);
    until(store, run, RunState.RUNNING);
    expect(store.engine.action(run.id, RunAction.PAUSE).ok).toBe(true);
    until(store, run, RunState.PAUSED);
    expect(store.engine.gpuAssignments().filter((g) => g === run.id)).toEqual(
      [],
    );
    expect(run.attempts[0]?.hasCheckpoint).toBe(true);
    store.engine.action(run.id, RunAction.RESUME);
    until(store, run, RunState.COMPLETED);
    expect(run.attempts).toHaveLength(2);
  });

  it("cancels in any active state", () => {
    const { store, p, workflowId } = setup();
    const queued = submit(store, p, workflowId);
    expect(store.engine.action(queued.id, RunAction.CANCEL).ok).toBe(true);
    expect(queued.state).toBe(RunState.CANCELLED);
    const running = submit(store, p, workflowId);
    until(store, running, RunState.RUNNING);
    store.engine.action(running.id, RunAction.CANCEL);
    until(store, running, RunState.CANCELLED);
    expect(store.engine.action(running.id, RunAction.CANCEL).ok).toBe(false);
  });
});

describe("queue (D102, D142)", () => {
  it("reserves freed GPUs for the head of the queue: no backfill", () => {
    const { store, p, workflowId } = setup();
    // 3 GPUs are free; the head needs 4 and blocks a 1-GPU Run behind it.
    const big = submit(store, p, workflowId, { gpus: 4 });
    const small = submit(store, p, workflowId, {
      gpus: 1,
      mode: DeterminismMode.FAST,
    });
    store.clock.advance(5_000);
    expect(big.state).toBe(RunState.QUEUED);
    expect(small.state).toBe(RunState.QUEUED);
    expect(store.engine.entries().map((e) => [e.runId, e.position])).toEqual([
      [big.id, 1],
      [small.id, 2],
      ["r-12", 0],
    ]);
    // Moving the small Run first lets it start.
    expect(store.engine.reorder(small.id, 1)).toBe(true);
    expect(small.state).toBe(RunState.RUNNING);
    expect(big.state).toBe(RunState.QUEUED);
    // The fixture Run finishing frees its GPU, but not enough for big yet.
    store.engine.action("r-12", RunAction.CANCEL);
    until(store, small, RunState.COMPLETED);
    until(store, big, RunState.RUNNING);
    expect(big.gpuIndices).toEqual([0, 1, 2, 3]);
  });

  it("publishes counts, the queue and run state changes", () => {
    const { store, p, workflowId } = setup();
    const events: string[] = [];
    store.engine.onQueueEvent((event) => events.push(event.event.case ?? ""));
    submit(store, p, workflowId);
    expect(events).toEqual(
      expect.arrayContaining(["runState", "entries", "summary"]),
    );
    expect(store.queue).toMatchObject({ queued: 1, running: 1, gpusBusy: 1 });
  });

  it("rejects cache hits from other hardware in a strict project (D78, D125)", () => {
    const { store, p, workflowId } = setup();
    const first = submit(store, p, workflowId);
    until(store, first, RunState.COMPLETED);
    store.project(p)!.settings!.strictCache = true;
    store.gpuModel = "MI250X";
    const second = submit(store, p, workflowId);
    expect(second.cacheHit).toBe(false);
  });
});

describe("re-runs (D62, D101)", () => {
  it("re-runs from the cache, or on a newer build as rebuilt", () => {
    const { store, p, workflowId } = setup();
    const first = submit(store, p, workflowId);
    until(store, first, RunState.COMPLETED);
    const same = rerun(store, p, first.id, {
      inputs: RerunInputs.SAME,
      gpus: 0,
      mode: 0,
    });
    expect(same.ok && same.value.cacheHit).toBe(true);
    store.engineBuild = "build-2026.11.0";
    const rebuilt = rerun(store, p, first.id, {
      inputs: RerunInputs.SAME,
      gpus: 0,
      mode: 0,
    });
    expect(rebuilt.ok && rebuilt.value).toMatchObject({
      state: RunState.QUEUED,
      rerunOf: first.id,
      tags: [ProvenanceTag.REBUILT],
    });
  });

  it("re-runs with the latest inputs (D101)", () => {
    const { store } = setup();
    // r-03 pinned geo-v1 and scn-v1; their heads are geo-v2 and scn-v2.
    const latest = rerun(store, "p-baseline", "r-03", {
      inputs: RerunInputs.LATEST,
      gpus: 0,
      mode: 0,
    });
    if (!latest.ok) throw new Error(latest.message);
    expect(
      latest.value.provenance?.inputs.find(
        (i) => i.kind === EntityKind.GEOMETRY,
      )?.versionHash,
    ).toBe("sha256:geo-v2");
    // Same inputs as r-11: every step comes from r-11's cache entries.
    expect(latest.value.cacheHit).toBe(true);
  });

  it("emits a solved scenario version after the equilibrium (D110)", () => {
    const { store, p, workflowId } = setup();
    const run = submit(store, p, workflowId);
    until(store, run, RunState.COMPLETED);
    const scenario = store.entity(p, EntityKind.SCENARIO, "scn-flattop")!;
    expect(scenario.versions[0]).toMatchObject({
      mintedBy: 3,
      sourceId: run.id,
    });
  });
});

describe("scripts", () => {
  it("keeps every failure on a real step", () => {
    const workflow = create(WorkflowSchema, chainWorkflow());
    for (const script of Object.values(RUN_SCRIPTS)) {
      const step =
        (script as { failure?: { step: number } }).failure?.step ?? 0;
      expect(step).toBeLessThan(workflow.nodes.length);
    }
  });
});
