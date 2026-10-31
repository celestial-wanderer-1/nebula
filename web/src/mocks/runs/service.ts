import { create } from "@bufbuild/protobuf";
import {
  anyPack,
  anyUnpack,
  timestampFromMs,
  type Any,
} from "@bufbuild/protobuf/wkt";
import {
  ChangeType,
  EntityKind,
  EntityRefSchema,
  MintedBy,
  VersionMetaSchema,
  type EntityRef,
} from "../../gen/nebula/core/v1/entity_pb";
import type { RunOutput } from "../../gen/nebula/core/v1/output_pb";
import {
  IssueSeverity,
  ValidationIssueSchema,
  type ValidationIssue,
} from "../../gen/nebula/core/v1/project_pb";
import { RegionSchema, RegionType } from "../../gen/nebula/core/v1/region_pb";
import {
  PlasmaTargetsSchema,
  ScenarioSchema,
} from "../../gen/nebula/core/v1/scenario_pb";
import { EquilibriumScalarsSchema } from "../../gen/nebula/core/v1/output_pb";
import type { Study, StudyPoint } from "../../gen/nebula/core/v1/study_pb";
import type { Node } from "../../gen/nebula/core/v1/workflow_pb";
import {
  AttemptSchema,
  DeterminismClass,
  DeterminismMode,
  PinnedInputSchema,
  ProvenanceSchema,
  ProvenanceTag,
  ReproducibilityClass,
  RerunInputs,
  RunSchema,
  RunState,
  StepState,
  StepStatusSchema,
  SubmitRunResponseSchema,
  type PinnedInput,
  type RerunRequest,
  type Run,
  type SubmitRunRequest,
  type SubmitRunResponse,
} from "../../gen/nebula/core/v1/run_pb";
import {
  WorkflowSchema,
  type Workflow,
} from "../../gen/nebula/core/v1/workflow_pb";
import { extensionIndex, stepOf } from "../../workflow/ports";
import { mockSchema } from "../fixtures";
import { contentHash } from "../hash";
import { mintReachable, versionHash } from "../minting";
import { mapRefs, pinnedRef } from "../refs";
import type { MockStore, StoreResult } from "../store";
import { RunEngine, topologicalSteps } from "./engine";

// Run submission and actions of the mock server (A§3.4, A§13.5, A§14.1),
// over the store's entities and the RunEngine.

export const ENGINE_BUILD = "build-2026.10.1";

const REGION_TYPES: Partial<Record<string, RegionType>> = {
  points: RegionType.POINTS,
  line: RegionType.LINE,
  plane: RegionType.PLANE,
  boxGrid: RegionType.BOX_GRID,
  cylindricalGrid: RegionType.CYLINDRICAL_GRID,
  toroidalGrid: RegionType.TOROIDAL_GRID,
  componentSurface: RegionType.COMPONENT_SURFACE,
  meshVolume: RegionType.MESH_VOLUME,
  stepOutputSurface: RegionType.STEP_OUTPUT_SURFACE,
};

const ok = <T>(value: T): StoreResult<T> => ({ ok: true, value });
const fail = <T>(
  status: number,
  code: string,
  message: string,
): StoreResult<T> => ({
  ok: false,
  status,
  code,
  message,
});

const unpackWorkflow = (content: Parameters<typeof anyUnpack>[0] | undefined) =>
  (content && anyUnpack(content, WorkflowSchema)) ?? create(WorkflowSchema);

/** Creates the engine with the fixture Runs, their cache and r-12 running. */
export function startEngine(
  store: MockStore,
  runs: Run[],
  outputs: RunOutput[],
): RunEngine {
  const engine = new RunEngine({
    clock: store.clock,
    gpusTotal: 4,
    gpuModel: () => store.gpuModel,
    engineBuild: () => store.engineBuild,
    plugins: () => store.plugins,
    projectName: (id) => store.project(id)?.name ?? id,
    strictCache: (id) => Boolean(store.project(id)?.settings?.strictCache),
    regionType: (projectId, ref) => {
      const content = store.resolve(projectId, ref);
      const region = content && anyUnpack(content, RegionSchema);
      return region?.shape.case ? REGION_TYPES[region.shape.case] : undefined;
    },
    solvedScenario: (projectId, ref, runId) =>
      mintSolvedScenario(store, projectId, ref, runId),
    scalars: (run, node, output, hash) =>
      scalarsOf(store, run, node, output, hash),
  });
  engine.runs = runs;
  engine.outputs = outputs;
  engine.onQueueEvent((event) => {
    if (event.event.case !== "runState" || !event.event.value.studyId) return;
    const run = engine.run(event.event.value.runId);
    if (run) store.studies.onRunState(run);
  });
  for (const run of runs) {
    const record = store.entity(
      run.projectId,
      EntityKind.WORKFLOW,
      run.workflowId,
    );
    const content = record?.versionContents?.[run.workflowVersionHash];
    if (!content) continue;
    const workflow = unpackWorkflow(content);
    fillFixtureRun(run, workflow);
    run.provenance ??= provenance(
      store,
      run.projectId,
      workflow,
      run.workflowVersionHash,
      collectInputs(store, run.projectId, content),
      run.mode,
    );
    if (run.state === RunState.COMPLETED) {
      engine.seedCache(run.projectId, run, workflow);
    } else if (run.state === RunState.RUNNING) {
      engine.adoptRunning(
        run,
        workflow,
        "slow",
        { step: 0, iteration: 3 },
        [0],
      );
    }
  }
  return engine;
}

/** Gives a fixture Run the execution record a real one would have. */
function fillFixtureRun(run: Run, workflow: Workflow): void {
  run.gpus ||= 1;
  run.mode ||= DeterminismMode.DETERMINISTIC;
  if (run.state !== RunState.COMPLETED) return;
  run.reproducibility = ReproducibilityClass.BITWISE;
  run.startedAt = run.submittedAt;
  run.steps = topologicalSteps(workflow).map((node) =>
    create(StepStatusSchema, {
      nodeId: node.id,
      label: node.label || node.id,
      state: StepState.COMPLETED,
      ranks: 1,
      iteration: 6,
    }),
  );
  run.attempts = [
    create(AttemptSchema, {
      number: 1,
      state: RunState.COMPLETED,
      engineBuild: ENGINE_BUILD,
      runtimeVersions: {
        rocm: "7.1.0",
        rccl: "2.22.3",
        mpi: "Open MPI 5.0.6",
        driver: "6.10.5",
      },
      hardware: {
        vendor: "AMD",
        gpuModel: "MI300X",
        gpuUuids: ["GPU-5f8e0000"],
        gpuCount: 1,
        topology: "xGMI fully connected",
      },
      achieved: DeterminismClass.DETERMINISTIC,
      startedAt: run.submittedAt,
      endedAt: run.finishedAt,
      gpuIndices: [0],
      hasCheckpoint: true,
      checkpointEpoch: run.steps.length,
    }),
  ];
}

/**
 * Scalars an equilibrium step reports, from its scenario's plasma targets,
 * varied a little by the output hash so different inputs differ.
 */
function scalarsOf(
  store: MockStore,
  run: Run,
  node: Node,
  output: string,
  hash: string,
): Any | undefined {
  const step = stepOf(node);
  const jitter = (parseInt(hash.slice(-4), 16) / 0xffff - 0.5) * 0.02;
  if (step?.extensionId === "acme.demo.solver" && output === "scalars") {
    const desc = mockSchema.getMessage("acme.demo.v1.DemoScalars");
    return desc
      ? anyPack(
          desc,
          create(desc, {
            rippleMax: 0.004 * (1 + jitter),
            fieldOnAxis: 5.3 * (1 + jitter),
          } as never),
        )
      : undefined;
  }
  const ref = step?.bindings.find((b) => b.port === "scenario")?.ref;
  const content = ref && store.resolve(run.projectId, ref);
  const scenario = content && anyUnpack(content, ScenarioSchema);
  const targets = scenario?.plasmaTargets
    .map((any) => anyUnpack(any, PlasmaTargetsSchema))
    .find(Boolean);
  const current = targets?.plasmaCurrent || 1.5e7;
  // Coil-current overrides of a scan (D109) shift q95 with the field.
  const coil = Object.entries(run.overrides?.values ?? {})
    .filter(([path]) => path.endsWith("/current"))
    .map(([path, value]) => {
      const circuit = path.split("/")[3];
      const base = scenario?.currents.find(
        (c) => c.circuitId === circuit,
      )?.current;
      return base ? value / base : 1;
    })
    .reduce((a, b) => a * b, 1);
  return anyPack(
    EquilibriumScalarsSchema,
    create(EquilibriumScalarsSchema, {
      plasmaCurrent: current,
      q95: 3.3 * (1.5e7 / current) * coil * (1 + jitter),
      betaPoloidal: (targets?.betaPoloidal || 0.64) * (1 + jitter / 10),
      internalInductance: targets?.internalInductance || 0.8,
      axisR: targets?.axisR || 6.3,
      storedEnergy: 3.5e8 * (current / 1.5e7) ** 2,
    }),
  );
}

/** An equilibrium step emitted a solved scenario: a new version (D110). */
function mintSolvedScenario(
  store: MockStore,
  projectId: string,
  ref: EntityRef,
  runId: string,
): void {
  const record = store.entity(projectId, EntityKind.SCENARIO, ref.id);
  const resolved = store.resolve(projectId, ref);
  const scenario = resolved && anyUnpack(resolved, ScenarioSchema);
  if (!record || !scenario) return;
  // The solve adjusts the coil currents to meet the plasma targets.
  for (const current of scenario.currents) {
    current.current = Math.round(current.current * 1.0125);
  }
  const content = anyPack(ScenarioSchema, scenario);
  const hash = contentHash(
    "solved",
    runId,
    versionHash(EntityKind.SCENARIO, content),
  );
  const solved = create(VersionMetaSchema, {
    hash,
    mintedAt: timestampFromMs(store.clock.now()),
    mintedBy: MintedBy.SOLVED_SCENARIO,
    sourceId: runId,
    draftRevision: record.draft.revision,
  });
  // A solved scenario is a version, not the new head: references to the
  // scenario's head do not move to it (D110).
  const [head, ...rest] = record.versions;
  record.versions = head ? [head, solved, ...rest] : [solved];
  record.versionContents = { ...record.versionContents, [hash]: content };
  store.publishEntity(record, ChangeType.VERSION_MINTED, hash);
}

function mintContext(store: MockStore, projectId: string) {
  return {
    entity: (kind: EntityKind, id: string) => store.entity(projectId, kind, id),
    registry: mockSchema.typeRegistry,
    now: () => store.clock.now(),
    publish: (
      record: Parameters<MockStore["publishEntity"]>[0],
      change: ChangeType,
      hash: string,
    ) => store.publishEntity(record, change, hash),
  };
}

/**
 * GPU counts for a workflow (A§13.5, D102, D116): the default is the
 * largest manifest hint; allowed counts are those every scaling step
 * supports, up to the installed GPUs. Non-scaling steps run on rank 0.
 */
function gpuCounts(store: MockStore, workflow: Workflow) {
  const extensions = extensionIndex(store.plugins);
  const steps = topologicalSteps(workflow)
    .map((node) => extensions.get(stepOf(node)?.extensionId ?? ""))
    .filter((e) => e !== undefined);
  const installed = store.queue.gpusTotal;
  const allowed = Array.from({ length: installed }, (_, i) => i + 1).filter(
    (n) =>
      steps.every((e) => {
        const counts = e.gpu?.rankCounts ?? [];
        return counts.length <= 1 || counts.includes(n);
      }),
  );
  const hint = Math.max(1, ...steps.map((e) => e.gpu?.defaultGpus ?? 1));
  const fallback = allowed.filter((n) => n <= hint).at(-1) ?? allowed[0] ?? 1;
  return {
    allowed,
    installed,
    defaultGpus: allowed.includes(hint) ? hint : fallback,
  };
}

function provenance(
  store: MockStore,
  projectId: string,
  workflow: Workflow,
  workflowVersionHash: string,
  inputs: PinnedInput[],
  mode: DeterminismMode,
) {
  const used = new Set(
    workflow.nodes.map((n) => stepOf(n)?.extensionId).filter(Boolean),
  );
  const plugins = store.plugins.filter((p) =>
    p.extensions.some((e) => used.has(e.id)),
  );
  return create(ProvenanceSchema, {
    inputs,
    concept: store.project(projectId)?.concept,
    workflowVersionHash,
    plugins: plugins.map((p) => ({
      pluginId: p.id,
      version: p.version,
      soHash: p.soHash,
    })),
    engineBuild: store.engineBuild,
    source: {
      engineCommit: "4f2a9c1",
      pluginCommits: Object.fromEntries(
        plugins.map((p) => [p.id, contentHash(p.id).slice(7, 14)]),
      ),
      compiler: "clang 19.1",
      dirty: false,
    },
    mode,
    storedInputs: workflow.nodes.flatMap((n) =>
      n.kind.case === "storedOutput"
        ? [n.kind.value.contentHash]
        : n.kind.case === "inputDataset"
          ? [n.kind.value.versionHash]
          : [],
    ),
  });
}

/**
 * POST /projects/{p}/runs (A§3.4): validates the workflow draft, mints
 * every reached draft in one pass, resolves the cache and queues the Run,
 * or completes it at once on a full cache hit. A dry run only reports.
 */
export function submitRun(
  store: MockStore,
  projectId: string,
  request: Pick<
    SubmitRunRequest,
    "workflowId" | "gpus" | "mode" | "dryRun" | "name" | "rerunOf"
  >,
): StoreResult<SubmitRunResponse> {
  const project = store.project(projectId);
  const record = store.entity(
    projectId,
    EntityKind.WORKFLOW,
    request.workflowId,
  );
  if (!project || !record) return fail(404, "not_found", "Workflow not found");
  const draft = unpackWorkflow(record.draft.content);
  const counts = gpuCounts(store, draft);
  const gpus = request.gpus || counts.defaultGpus;
  const mode = request.mode || DeterminismMode.DETERMINISTIC;
  const validated = store.validateWorkflow(projectId, record.draft.id, gpus);
  const issues: ValidationIssue[] = validated.ok ? validated.value : [];
  if (!counts.allowed.includes(gpus) && gpus <= counts.installed) {
    issues.push(
      create(ValidationIssueSchema, {
        severity: IssueSeverity.ERROR,
        code: "rank_count",
        message: `The steps cannot all run on ${gpus} GPUs; choose ${counts.allowed.join(", ")}`,
      }),
    );
  }
  const draftRef = create(EntityRefSchema, {
    kind: EntityKind.WORKFLOW,
    id: record.draft.id,
    state: { case: "draft", value: {} },
  });
  const preview = mintReachable(mintContext(store, projectId), draftRef, {
    commit: false,
    sourceId: "",
  });
  const pinned = unpackWorkflow(preview.content);
  const plan = store.engine.planSteps(projectId, pinned, mode);
  const response = create(SubmitRunResponseSchema, {
    minted: preview.minted,
    issues,
    cacheHit: plan.cached.size === plan.order.length,
    cachedSteps: [...plan.cached.keys()],
    defaultGpus: counts.defaultGpus,
    maxGpus: counts.installed,
    allowedGpus: counts.allowed,
  });
  if (
    request.dryRun ||
    issues.some((i) => i.severity === IssueSeverity.ERROR)
  ) {
    return ok(response);
  }

  const runId = store.engine.newRunId();
  const minted = mintReachable(mintContext(store, projectId), draftRef, {
    commit: true,
    sourceId: runId,
  });
  const workflowVersionHash =
    minted.ref.state.case === "pinned"
      ? minted.ref.state.value.versionHash
      : "";
  project.runCount += 1;
  const run = create(RunSchema, {
    id: runId,
    projectId,
    name: request.name.trim() || `${record.draft.name} #${project.runCount}`,
    workflowId: record.draft.id,
    workflowVersionHash,
    gpus,
    mode,
    rerunOf: request.rerunOf,
    provenance: provenance(
      store,
      projectId,
      pinned,
      workflowVersionHash,
      minted.inputs,
      mode,
    ),
  });
  tagRebuilt(store, run);
  response.run = store.engine.submit(run, pinned, plan);
  return ok(response);
}

/** A re-run on a newer build than its original is "rebuilt" (D62). */
function tagRebuilt(store: MockStore, run: Run): void {
  const original = run.rerunOf ? store.engine.run(run.rerunOf) : undefined;
  const build = original?.attempts[0]?.engineBuild;
  if (build && build !== store.engineBuild)
    run.tags.push(ProvenanceTag.REBUILT);
}

/**
 * POST /projects/{p}/runs/{r}/rerun: the original's workflow version with
 * the same pinned inputs, or every input at its head version (D101).
 * Unchanged steps come from the cache.
 */
export function rerun(
  store: MockStore,
  projectId: string,
  runId: string,
  request: Pick<RerunRequest, "inputs" | "gpus" | "mode">,
): StoreResult<Run> {
  const original = store.run(projectId, runId);
  const record =
    original &&
    store.entity(projectId, EntityKind.WORKFLOW, original.workflowId);
  const content =
    record?.versionContents?.[original?.workflowVersionHash ?? ""];
  if (!original || !record || !content)
    return fail(404, "not_found", "Run not found");
  const newId = store.engine.newRunId();
  let workflowContent = content;
  if (request.inputs === RerunInputs.LATEST) {
    workflowContent = mapRefs(content, mockSchema.typeRegistry, (ref) => {
      const head = store.entity(projectId, ref.kind, ref.id)?.versions[0]?.hash;
      return head ? pinnedRef(ref, head) : ref;
    });
  }
  const hash = versionHash(EntityKind.WORKFLOW, workflowContent);
  if (!record.versions.some((v) => v.hash === hash)) {
    record.versions = [
      create(VersionMetaSchema, {
        hash,
        mintedAt: timestampFromMs(store.clock.now()),
        mintedBy: MintedBy.RUN_SUBMISSION,
        sourceId: newId,
        draftRevision: record.draft.revision,
      }),
      ...record.versions,
    ];
    record.versionContents = {
      ...record.versionContents,
      [hash]: workflowContent,
    };
    store.publishEntity(record, ChangeType.VERSION_MINTED, hash);
  }
  const workflow = unpackWorkflow(workflowContent);
  const inputs = collectInputs(store, projectId, workflowContent);
  const mode = request.mode || original.mode || DeterminismMode.DETERMINISTIC;
  const plan = store.engine.planSteps(projectId, workflow, mode);
  const project = store.project(projectId)!;
  project.runCount += 1;
  const run = create(RunSchema, {
    id: newId,
    projectId,
    name: `${original.name} (re-run)`,
    workflowId: original.workflowId,
    workflowVersionHash: hash,
    gpus: request.gpus || original.gpus || 1,
    mode,
    rerunOf: original.id,
    studyId: original.studyId,
    overrides: original.overrides,
    provenance: provenance(store, projectId, workflow, hash, inputs, mode),
  });
  tagRebuilt(store, run);
  return ok(store.engine.submit(run, workflow, plan));
}

/** The pinned versions a workflow version reaches (A§4.3). */
function collectInputs(
  store: MockStore,
  projectId: string,
  content: Parameters<typeof mapRefs>[0],
): PinnedInput[] {
  const found = new Map<string, PinnedInput>();
  const visit = (ref: EntityRef): EntityRef => {
    if (ref.state.case !== "pinned") return ref;
    const hash = ref.state.value.versionHash;
    const key = `${ref.kind}/${ref.id}@${hash}`;
    if (!found.has(key)) {
      const record = store.entity(projectId, ref.kind, ref.id);
      found.set(
        key,
        create(PinnedInputSchema, {
          kind: ref.kind,
          id: ref.id,
          name: record?.draft.name ?? ref.id,
          versionHash: hash,
        }),
      );
      const inner = record?.versionContents?.[hash];
      if (inner) mapRefs(inner, mockSchema.typeRegistry, visit);
    }
    return ref;
  };
  mapRefs(content, mockSchema.typeRegistry, visit);
  return [...found.values()];
}

/**
 * A scan point's Run (A§12.4, D109): the Study's pinned base Workflow
 * version with the point's override vector, which is part of the cache
 * key, so identical points reuse results.
 */
export function submitPoint(
  store: MockStore,
  projectId: string,
  study: Study,
  point: StudyPoint,
): Run | undefined {
  const record = store.entity(projectId, EntityKind.WORKFLOW, study.workflowId);
  const content = record?.versionContents?.[study.workflowVersionHash];
  if (!record || !content) return undefined;
  const workflow = unpackWorkflow(content);
  const overrides = { ...(point.overrides?.values ?? {}) };
  const plan = store.engine.planSteps(
    projectId,
    workflow,
    study.mode,
    overrides,
  );
  const project = store.project(projectId)!;
  project.runCount += 1;
  const inputs = collectInputs(store, projectId, content);
  const run = create(RunSchema, {
    id: store.engine.newRunId(),
    projectId,
    name: `${study.name} · point ${point.index + 1}`,
    workflowId: study.workflowId,
    workflowVersionHash: study.workflowVersionHash,
    gpus: study.gpusPerRun,
    mode: study.mode,
    studyId: study.id,
    overrides: { values: overrides },
  });
  run.provenance = provenance(
    store,
    projectId,
    workflow,
    study.workflowVersionHash,
    inputs,
    study.mode,
  );
  run.provenance.baseWorkflowVersionHash = study.workflowVersionHash;
  run.provenance.overrides = run.overrides;
  return store.engine.submit(run, workflow, plan);
}
