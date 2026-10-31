import {
  clone,
  create,
  toBinary,
  type MessageInitShape,
} from "@bufbuild/protobuf";
import { AnySchema, timestampFromMs } from "@bufbuild/protobuf/wkt";
import type { EntityRef } from "../../gen/nebula/core/v1/entity_pb";
import {
  OutputKind,
  RunOutputSchema,
  type RunOutput,
} from "../../gen/nebula/core/v1/output_pb";
import type { Extension, PluginInfo } from "../../gen/nebula/core/v1/plugin_pb";
import {
  QueueEntrySchema,
  QueueEventSchema,
  QueueSummarySchema,
  type QueueEntry,
  type QueueEvent,
  type QueueSummary,
} from "../../gen/nebula/core/v1/queue_pb";
import type { RegionType } from "../../gen/nebula/core/v1/region_pb";
import {
  AttemptSchema,
  DeterminismClass,
  DeterminismMode,
  FailureReason,
  HardwareSchema,
  LogLevel,
  ProvenanceTag,
  ReproducibilityClass,
  RunAction,
  RunEventSchema,
  RunState,
  StepState,
  StepStatusSchema,
  type Attempt,
  type Run,
  type RunEvent,
  type StepStatus,
} from "../../gen/nebula/core/v1/run_pb";
import type { Node, Workflow } from "../../gen/nebula/core/v1/workflow_pb";
import { stepOf } from "../../workflow/ports";
import type { MockClock } from "../clock";
import { contentHash } from "../hash";
import {
  RUN_SCRIPTS,
  TRANSIENT_FAILURES,
  type RunScript,
  type RunScriptName,
} from "./scripts";

// The supervisor stand-in (A§3.4 to A§3.7, A§14.1): a FIFO queue on a
// homogeneous set of GPUs with head-of-queue reservation and no backfill
// (D102, D142), Preparing before the GPU wait (D121), scripted progress,
// failures and checkpoints, and the step cache (A§4.6).

type RunEventInit = MessageInitShape<typeof RunEventSchema>["event"];
type QueueEventInit = MessageInitShape<typeof QueueEventSchema>["event"];

const BACKLOG = 400;
const PREPARE_DELAY_MS = 100;
const PAUSE_DELAY_MS = 300;
const KILL_DELAY_MS = 200;

/** What the engine needs from the store. */
export interface EngineContext {
  clock: MockClock;
  gpusTotal: number;
  gpuModel: () => string;
  engineBuild: () => string;
  plugins: () => readonly PluginInfo[];
  projectName: (projectId: string) => string;
  strictCache: (projectId: string) => boolean;
  regionType: (projectId: string, ref: EntityRef) => RegionType | undefined;
  /** An equilibrium step committed: mint the solved scenario (D110). */
  solvedScenario: (projectId: string, ref: EntityRef, runId: string) => void;
}

interface CacheEntry {
  runId: string;
  outputs: RunOutput[];
  gpuModel: string;
}

/** Where execution resumes: a step and its iteration. */
interface Position {
  step: number;
  iteration: number;
}

interface Active {
  run: Run;
  workflow: Workflow;
  /** Executed steps in topological order; cached ones are not here. */
  order: Node[];
  keys: Map<string, string>;
  script: RunScript;
  failureUsed: boolean;
  prepared: boolean;
  position: Position;
  checkpoint?: Position;
  epoch: number;
  timer?: number;
}

export interface StepPlan {
  /** Every step in topological order. */
  order: Node[];
  keys: Map<string, string>;
  /** Steps whose outputs come from the cache, with their entries. */
  cached: Map<string, CacheEntry>;
}

const ACTIVE_STATES = new Set([
  RunState.QUEUED,
  RunState.PREPARING,
  RunState.RUNNING,
  RunState.PAUSED,
]);
const TERMINAL = new Set([
  RunState.COMPLETED,
  RunState.FAILED,
  RunState.CANCELLED,
  RunState.DISCARDED,
]);

export const isTerminal = (state: RunState) => TERMINAL.has(state);

/** Extension steps in dependency order; coupled groups iterate inside. */
export function topologicalSteps(workflow: Workflow): Node[] {
  const steps = workflow.nodes.filter((n) => stepOf(n));
  const ids = new Set(steps.map((n) => n.id));
  const groupOf = (id: string) => {
    const parent = workflow.nodes.find(
      (n) => n.id === workflow.nodes.find((m) => m.id === id)?.parentId,
    );
    return parent?.kind.case === "coupled" ? parent.id : undefined;
  };
  const edges = workflow.edges.filter((edge) => {
    const from = edge.from?.nodeId ?? "";
    const to = edge.to?.nodeId ?? "";
    if (!ids.has(from) || !ids.has(to)) return false;
    const group = groupOf(from);
    return !(group && group === groupOf(to));
  });
  const order: Node[] = [];
  const placed = new Set<string>();
  while (order.length < steps.length) {
    const ready = steps.filter(
      (n) =>
        !placed.has(n.id) &&
        edges.every(
          (e) => e.to?.nodeId !== n.id || placed.has(e.from?.nodeId ?? ""),
        ),
    );
    // A cycle the validation reports; run the rest in declaration order.
    const next = ready.length ? ready : steps.filter((n) => !placed.has(n.id));
    for (const node of next) {
      placed.add(node.id);
      order.push(node);
    }
  }
  return order;
}

export class RunEngine {
  runs: Run[] = [];
  outputs: RunOutput[] = [];
  readonly cache = new Map<string, CacheEntry>();
  private readonly active = new Map<string, Active>();
  /** Waiting Runs in FIFO order (D102). */
  private queue: string[] = [];
  /** Run ID per GPU index, while running. */
  private gpus: (string | undefined)[];
  private readonly runListeners = new Map<
    string,
    Set<(event: RunEvent) => void>
  >();
  private readonly queueListeners = new Set<(event: QueueEvent) => void>();
  private readonly backlog = new Map<string, RunEvent[]>();
  private nextScript: RunScriptName = "success";
  private nextRun = 100;

  constructor(private readonly context: EngineContext) {
    this.gpus = Array.from({ length: context.gpusTotal }, () => undefined);
  }

  // Reading.

  run(runId: string): Run | undefined {
    return this.runs.find((run) => run.id === runId);
  }

  runOutputs(runId: string): RunOutput[] {
    return this.outputs.filter((output) => output.runId === runId);
  }

  gpuAssignments(): readonly (string | undefined)[] {
    return this.gpus;
  }

  summary(): QueueSummary {
    const count = (state: RunState) =>
      this.runs.filter((run) => run.state === state).length;
    return create(QueueSummarySchema, {
      queued: count(RunState.QUEUED),
      preparing: count(RunState.PREPARING),
      running: count(RunState.RUNNING),
      gpusTotal: this.context.gpusTotal,
      gpusBusy: this.gpus.filter(Boolean).length,
    });
  }

  /** Waiting Runs in queue order, then running, then paused ones. */
  entries(): QueueEntry[] {
    const entry = (run: Run, position: number) =>
      create(QueueEntrySchema, {
        runId: run.id,
        projectId: run.projectId,
        projectName: this.context.projectName(run.projectId),
        runName: run.name,
        state: run.state,
        gpus: run.gpus,
        gpuIndices: run.gpuIndices,
        position,
        studyId: run.studyId,
        submittedAt: run.submittedAt,
      });
    const waiting = this.queue
      .map((id) => this.run(id))
      .filter((run): run is Run => Boolean(run));
    const by = (state: RunState) =>
      this.runs
        .filter((run) => run.state === state)
        .map((run) => entry(run, 0));
    return [
      ...waiting.map((run, i) => entry(run, i + 1)),
      ...by(RunState.RUNNING),
      ...by(RunState.PAUSED),
    ];
  }

  /** Recent progress of a Run, replayed to a new subscriber. */
  recent(runId: string): RunEvent[] {
    return this.backlog.get(runId) ?? [];
  }

  // Subscriptions.

  onRunEvent(runId: string, listener: (event: RunEvent) => void): () => void {
    const set = this.runListeners.get(runId) ?? new Set();
    set.add(listener);
    this.runListeners.set(runId, set);
    return () => set.delete(listener);
  }

  onQueueEvent(listener: (event: QueueEvent) => void): () => void {
    this.queueListeners.add(listener);
    return () => this.queueListeners.delete(listener);
  }

  scriptNextRun(name: RunScriptName): void {
    this.nextScript = name;
  }

  // The step cache (A§4.6).

  private extension(node: Node): Extension | undefined {
    const id = stepOf(node)?.extensionId;
    return this.context
      .plugins()
      .flatMap((p) => p.extensions)
      .find((e) => e.id === id);
  }

  private soHash(node: Node): string {
    const id = stepOf(node)?.extensionId;
    return (
      this.context.plugins().find((p) => p.extensions.some((e) => e.id === id))
        ?.soHash ?? ""
    );
  }

  /**
   * A step's cache key (A§4.6): config, pinned inputs and upstream output
   * hashes, plugin code identity, engine build and mode. Undefined while an
   * upstream output is unknown.
   */
  stepKey(
    workflow: Workflow,
    node: Node,
    mode: DeterminismMode,
    overrides: Readonly<Record<string, number>>,
    outputsOf: (nodeId: string) => readonly RunOutput[] | undefined,
  ): string | undefined {
    const upstream: string[] = [];
    for (const edge of workflow.edges.filter((e) => e.to?.nodeId === node.id)) {
      const source = workflow.nodes.find((n) => n.id === edge.from?.nodeId);
      if (source?.kind.case === "storedOutput") {
        upstream.push(source.kind.value.contentHash);
      } else if (source?.kind.case === "inputDataset") {
        upstream.push(source.kind.value.versionHash);
      } else {
        const hash = outputsOf(source?.id ?? "")?.find(
          (o) => o.name === edge.from?.port,
        )?.contentHash;
        if (!hash) return undefined;
        upstream.push(`${edge.to?.port}=${hash}`);
      }
    }
    const step = stepOf(node)!;
    return contentHash(
      "step",
      step.extensionId,
      step.config ? toBinary(AnySchema, step.config) : new Uint8Array(),
      ...step.bindings.map(
        (b) =>
          `${b.port}=${b.ref?.state.case === "pinned" ? b.ref.state.value.versionHash : ""}`,
      ),
      ...upstream,
      this.soHash(node),
      this.context.engineBuild(),
      DeterminismMode[mode],
      JSON.stringify(Object.entries(overrides).sort()),
    );
  }

  /**
   * Resolves step keys in topological order until the first miss (A§4.6):
   * a later key needs upstream output hashes, known only while every step
   * before it hits. With `outputsOf` (seeding), keys go on past misses.
   */
  planSteps(
    projectId: string,
    workflow: Workflow,
    mode: DeterminismMode,
    overrides: Readonly<Record<string, number>> = {},
    outputsOf?: (nodeId: string) => readonly RunOutput[] | undefined,
  ): StepPlan {
    const order = topologicalSteps(workflow);
    const keys = new Map<string, string>();
    const cached = new Map<string, CacheEntry>();
    const strict = this.context.strictCache(projectId);
    for (const node of order) {
      const key = this.stepKey(
        workflow,
        node,
        mode,
        overrides,
        (id) => outputsOf?.(id) ?? cached.get(id)?.outputs,
      );
      if (!key) break;
      keys.set(node.id, key);
      const entry = this.cache.get(key);
      if (!entry || (strict && entry.gpuModel !== this.context.gpuModel())) {
        if (outputsOf) continue;
        break;
      }
      cached.set(node.id, entry);
    }
    return { order, keys, cached };
  }

  /** Records a completed fixture Run's outputs as cache entries. */
  seedCache(projectId: string, run: Run, workflow: Workflow): void {
    const outputs = this.runOutputs(run.id);
    const byNode = (nodeId: string) => {
      const found = outputs.filter((o) => o.nodeId === nodeId);
      return found.length ? found : undefined;
    };
    const plan = this.planSteps(projectId, workflow, run.mode, {}, byNode);
    for (const node of plan.order) {
      const key = plan.keys.get(node.id);
      const own = byNode(node.id);
      if (key && own && !this.cache.has(key)) {
        this.cache.set(key, {
          runId: run.id,
          outputs: own,
          gpuModel: this.context.gpuModel(),
        });
      }
    }
  }

  // Submission and actions (A§3.4, A§14.1).

  newRunId(): string {
    return `r-${this.nextRun++}`;
  }

  /**
   * Records a submitted Run. With every step cached it completes at once,
   * its outputs linked from the cache (A§3.4); otherwise it is queued and
   * prepares before waiting for GPUs (D121).
   */
  submit(run: Run, workflow: Workflow, plan: StepPlan): Run {
    const now = this.now();
    run.submittedAt = now;
    run.steps = plan.order.map((node) => {
      const entry = plan.cached.get(node.id);
      return create(StepStatusSchema, {
        nodeId: node.id,
        label: node.label || node.id,
        state: entry ? StepState.CACHED : StepState.PENDING,
        cacheProducerRunId: entry?.runId ?? "",
        cacheKey: plan.keys.get(node.id) ?? "",
      });
    });
    this.runs.unshift(run);
    for (const entry of plan.cached.values()) {
      for (const output of entry.outputs) {
        this.outputs.push(
          create(RunOutputSchema, {
            ...output,
            runId: run.id,
            producerRunId: entry.runId,
            committedAt: now,
          }),
        );
      }
    }
    if (plan.cached.size === plan.order.length) {
      run.state = RunState.COMPLETED;
      run.cacheHit = true;
      run.finishedAt = now;
      run.reproducibility = ReproducibilityClass.BITWISE;
      this.emitRun(run);
      return run;
    }
    const script = RUN_SCRIPTS[this.nextScript];
    this.nextScript = "success";
    const active: Active = {
      run,
      workflow,
      order: plan.order.filter((node) => !plan.cached.has(node.id)),
      keys: plan.keys,
      script,
      failureUsed: false,
      prepared: false,
      position: { step: 0, iteration: 0 },
      epoch: 0,
    };
    this.active.set(run.id, active);
    run.state = RunState.QUEUED;
    run.attempts = [this.newAttempt(1)];
    this.queue.push(run.id);
    this.emitRun(run);
    active.timer = this.context.clock.after(PREPARE_DELAY_MS, () =>
      this.prepare(active),
    );
    return run;
  }

  /** Adopts a fixture Run that is running when the mock starts. */
  adoptRunning(
    run: Run,
    workflow: Workflow,
    script: RunScriptName,
    position: Position,
    gpuIndices: number[],
  ): void {
    const order = topologicalSteps(workflow);
    const active: Active = {
      run,
      workflow,
      order,
      keys: new Map(),
      script: RUN_SCRIPTS[script],
      failureUsed: true,
      prepared: true,
      position,
      epoch: 0,
    };
    run.steps = order.map((node, i) =>
      create(StepStatusSchema, {
        nodeId: node.id,
        label: node.label || node.id,
        state:
          i < position.step
            ? StepState.COMPLETED
            : i === position.step
              ? StepState.RUNNING
              : StepState.PENDING,
        ranks: i === position.step ? run.gpus : 0,
        iteration: i === position.step ? position.iteration : 0,
      }),
    );
    for (const index of gpuIndices) this.gpus[index] = run.id;
    run.gpuIndices = gpuIndices;
    run.attempts = [
      {
        ...this.newAttempt(1),
        state: RunState.RUNNING,
        gpuIndices,
        hardware: this.hardware(gpuIndices),
        startedAt: run.submittedAt,
        achieved:
          run.mode === DeterminismMode.FAST
            ? DeterminismClass.NONDETERMINISTIC
            : DeterminismClass.DETERMINISTIC,
      },
    ];
    run.startedAt = run.submittedAt;
    this.updateTags(run);
    this.active.set(run.id, active);
    this.iterate(active);
  }

  action(
    runId: string,
    action: RunAction,
  ): { ok: true; run: Run } | { ok: false; message: string } {
    const run = this.run(runId);
    if (!run) return { ok: false, message: "Run not found" };
    const active = this.active.get(runId);
    const refuse = (what: string) => ({
      ok: false as const,
      message: `Cannot ${what} a ${RunState[run.state].toLowerCase()} run`,
    });
    switch (action) {
      case RunAction.PAUSE:
        if (run.state !== RunState.RUNNING || !active) return refuse("pause");
        this.context.clock.cancel(active.timer);
        active.timer = this.context.clock.after(PAUSE_DELAY_MS, () =>
          this.pause(active),
        );
        return { ok: true, run };
      case RunAction.RESUME: {
        const attempt = run.attempts.at(-1);
        const resumable =
          run.state === RunState.PAUSED ||
          (run.state === RunState.FAILED &&
            Boolean(attempt?.hasCheckpoint) &&
            TRANSIENT_FAILURES.has(
              attempt?.failure ?? FailureReason.UNSPECIFIED,
            ));
        if (!resumable || !active) return refuse("resume");
        this.resume(active);
        return { ok: true, run };
      }
      case RunAction.CANCEL:
        if (!ACTIVE_STATES.has(run.state)) return refuse("cancel");
        this.cancel(run, active);
        return { ok: true, run };
      case RunAction.DISCARD:
        if (run.state !== RunState.FAILED) return refuse("discard");
        run.state = RunState.DISCARDED;
        this.active.delete(run.id);
        this.emitRun(run);
        return { ok: true, run };
      default:
        return { ok: false, message: "Unknown action" };
    }
  }

  /** Moves a waiting Run to a 1-based position in the queue (D102). */
  reorder(runId: string, position: number): boolean {
    if (!this.queue.includes(runId)) return false;
    const rest = this.queue.filter((id) => id !== runId);
    const at = Math.max(0, Math.min(rest.length, position - 1));
    this.queue = [...rest.slice(0, at), runId, ...rest.slice(at)];
    this.emitQueue();
    this.pump();
    return true;
  }

  /** Cancels every timer; for a store reset. */
  stop(): void {
    for (const active of this.active.values()) {
      this.context.clock.cancel(active.timer);
    }
    this.active.clear();
  }

  // The lifecycle.

  private now() {
    return timestampFromMs(this.context.clock.now());
  }

  private newAttempt(number: number): Attempt {
    return create(AttemptSchema, {
      number,
      state: RunState.QUEUED,
      engineBuild: this.context.engineBuild(),
      runtimeVersions: {
        rocm: "7.1.0",
        rccl: "2.22.3",
        mpi: "Open MPI 5.0.6",
        driver: "6.10.5",
      },
    });
  }

  private hardware(gpuIndices: number[]) {
    return create(HardwareSchema, {
      vendor: "AMD",
      gpuModel: this.context.gpuModel(),
      gpuUuids: gpuIndices.map(
        (i) => `GPU-5f8e${i.toString(16).padStart(4, "0")}`,
      ),
      gpuCount: gpuIndices.length,
      topology: "xGMI fully connected",
    });
  }

  private attempt(active: Active): Attempt {
    return active.run.attempts.at(-1)!;
  }

  private setState(active: Active, state: RunState): void {
    active.run.state = state;
    this.attempt(active).state = state;
    this.emitRun(active.run);
  }

  private prepare(active: Active): void {
    this.setState(active, RunState.PREPARING);
    this.log(
      active,
      LogLevel.INFO,
      "",
      "Preparing: meshing, partitioning and discretizing geometry",
    );
    active.timer = this.context.clock.after(active.script.prepareMs, () => {
      const failure = active.script.failure;
      if (failure && failure.step < 0 && !active.failureUsed) {
        this.queue = this.queue.filter((id) => id !== active.run.id);
        this.fail(active, failure.reason, failure.detail, false);
        return;
      }
      active.prepared = true;
      this.setState(active, RunState.QUEUED);
      this.pump();
    });
  }

  /** Starts the head of the queue while its GPUs are free; no backfill. */
  private pump(): void {
    for (;;) {
      const headId = this.queue.find(
        (id) => this.run(id)?.state !== RunState.PREPARING,
      );
      const head = headId ? this.active.get(headId) : undefined;
      if (!head || !head.prepared) return;
      const free = this.gpus.flatMap((owner, i) => (owner ? [] : [i]));
      // Freed GPUs are reserved for the head of the queue (D142).
      if (free.length < head.run.gpus) return;
      this.queue = this.queue.filter((id) => id !== head.run.id);
      this.start(head, free.slice(0, head.run.gpus));
    }
  }

  private start(active: Active, gpuIndices: number[]): void {
    const { run } = active;
    for (const index of gpuIndices) this.gpus[index] = run.id;
    run.gpuIndices = gpuIndices;
    run.startedAt ??= this.now();
    const attempt = this.attempt(active);
    attempt.startedAt = this.now();
    attempt.gpuIndices = gpuIndices;
    attempt.hardware = this.hardware(gpuIndices);
    attempt.achieved =
      run.mode === DeterminismMode.FAST
        ? DeterminismClass.NONDETERMINISTIC
        : DeterminismClass.DETERMINISTIC;
    this.updateTags(run);
    this.setState(active, RunState.RUNNING);
    this.emitQueue();
    this.log(
      active,
      LogLevel.INFO,
      "",
      `Started attempt ${attempt.number} on GPUs ${gpuIndices.join(", ")}`,
    );
    this.iterate(active);
  }

  private step(active: Active): StepStatus | undefined {
    const node = active.order[active.position.step];
    return active.run.steps.find((s) => s.nodeId === node?.id);
  }

  /** Runs the next iteration of the current step, or the next step. */
  private iterate(active: Active): void {
    const node = active.order[active.position.step];
    if (!node) {
      this.complete(active);
      return;
    }
    const status = this.step(active)!;
    if (status.state !== StepState.RUNNING) {
      status.state = StepState.RUNNING;
      status.ranks = active.run.gpus;
      this.emitProgress(active, {
        case: "step",
        value: clone(StepStatusSchema, status),
      });
      this.log(
        active,
        LogLevel.INFO,
        node.id,
        `${status.label} started on ${active.run.gpus} ranks`,
      );
    }
    active.timer = this.context.clock.after(active.script.iterationMs, () => {
      const { step, iteration } = active.position;
      const failure = active.script.failure;
      if (
        failure &&
        !active.failureUsed &&
        failure.step >= 0 &&
        Math.min(failure.step, active.order.length - 1) === step &&
        failure.iteration === iteration
      ) {
        active.failureUsed = true;
        status.state = StepState.FAILED;
        this.emitProgress(active, {
          case: "step",
          value: clone(StepStatusSchema, status),
        });
        const attempt = this.attempt(active);
        attempt.failedStep = node.id;
        if (failure.rank !== undefined) attempt.failedRank = failure.rank;
        this.fail(
          active,
          failure.reason,
          failure.detail,
          failure.checkpoint && active.epoch > 0,
        );
        return;
      }
      const residual =
        0.2 * 0.45 ** iteration * (1 + 0.1 * Math.sin(step + iteration));
      status.iteration = iteration + 1;
      this.emitProgress(active, {
        case: "residual",
        value: {
          nodeId: node.id,
          iteration: iteration + 1,
          name: "residual",
          value: residual,
        },
      });
      if (iteration % 2 === 1) {
        this.log(
          active,
          LogLevel.DEBUG,
          node.id,
          `Iteration ${iteration + 1}: residual ${residual.toExponential(3)}`,
          {
            iteration: String(iteration + 1),
          },
        );
      }
      if (iteration + 1 < active.script.iterations) {
        active.position = { step, iteration: iteration + 1 };
        this.iterate(active);
        return;
      }
      this.finishStep(active, node, status);
      active.position = { step: step + 1, iteration: 0 };
      // A checkpoint epoch at every step boundary (A§3.7).
      active.epoch += 1;
      active.checkpoint = { ...active.position };
      const attempt = this.attempt(active);
      attempt.hasCheckpoint = true;
      attempt.checkpointEpoch = active.epoch;
      this.emitProgress(active, {
        case: "checkpoint",
        value: { attempt: attempt.number, epoch: active.epoch },
      });
      this.iterate(active);
    });
  }

  private finishStep(active: Active, node: Node, status: StepStatus): void {
    const { run, workflow } = active;
    const extension = this.extension(node);
    const step = stepOf(node)!;
    const regionRef = step.bindings.find((b) => b.port === "region")?.ref;
    const regionType =
      regionRef && this.context.regionType(run.projectId, regionRef);
    // Known once this Run committed the step's upstream outputs.
    const key =
      active.keys.get(node.id) ??
      this.stepKey(
        workflow,
        node,
        run.mode,
        run.overrides?.values ?? {},
        (id) => this.runOutputs(run.id).filter((o) => o.nodeId === id),
      ) ??
      contentHash(run.id, node.id);
    const committed: RunOutput[] = [];
    const parent = workflow.nodes.find((n) => n.id === node.parentId);
    for (const port of extension?.outputs ?? []) {
      const subContract =
        port.type?.type.case === "subContract" ? port.type.type.value : "";
      const hash = contentHash(key, port.name);
      const regionField =
        port.outputKind === OutputKind.REGION_FIELD && regionType;
      // Steps inside a fan-out map over time slices (D92).
      const timeSeries =
        Boolean(port.type?.timeSeries) || parent?.kind.case === "fanOut";
      const output = create(RunOutputSchema, {
        runId: run.id,
        nodeId: node.id,
        name: port.name,
        subContract,
        contentHash: hash,
        timeSeries,
        committedAt: this.now(),
        kind: port.outputKind,
        regionType: regionField ? regionType : 0,
        regionId: regionField ? regionRef.id : "",
        attempt: this.attempt(active).number,
        datasets: [
          {
            owner: run.id,
            filePath: `runs/${run.id}/${node.id}.h5`,
            datasetPath: `/${port.name}`,
            contentHash: hash,
          },
        ],
        time: timeSeries
          ? {
              base: port.type?.timeBase || "slices",
              times: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => t * 0.5),
            }
          : undefined,
      });
      this.outputs.push(output);
      committed.push(output);
      this.emitProgress(active, { case: "output", value: output });
    }
    status.state = StepState.COMPLETED;
    this.emitProgress(active, {
      case: "step",
      value: clone(StepStatusSchema, status),
    });
    this.log(
      active,
      LogLevel.INFO,
      node.id,
      `${status.label} committed ${committed.length} outputs`,
    );
    if (!this.cache.has(key)) {
      // The first committed result for a key wins (D152).
      this.cache.set(key, {
        runId: run.id,
        outputs: committed,
        gpuModel: this.context.gpuModel(),
      });
    }
    const scenario = step.bindings.find((b) => b.port === "scenario")?.ref;
    if (extension?.calculationType === "equilibrium" && scenario) {
      this.context.solvedScenario(run.projectId, scenario, run.id);
    }
  }

  private release(run: Run): void {
    this.gpus = this.gpus.map((owner) =>
      owner === run.id ? undefined : owner,
    );
    run.gpuIndices = [];
  }

  private endAttempt(active: Active): void {
    this.attempt(active).endedAt = this.now();
  }

  private complete(active: Active): void {
    const { run } = active;
    this.release(run);
    this.endAttempt(active);
    run.finishedAt = this.now();
    this.active.delete(run.id);
    this.log(active, LogLevel.INFO, "", "Run completed");
    this.setState(active, RunState.COMPLETED);
    this.pump();
    this.emitQueue();
  }

  private fail(
    active: Active,
    reason: FailureReason,
    detail: string,
    checkpoint: boolean,
  ): void {
    const { run } = active;
    const attempt = this.attempt(active);
    attempt.failure = reason;
    attempt.failureDetail = detail;
    attempt.hasCheckpoint = checkpoint;
    this.release(run);
    this.endAttempt(active);
    run.finishedAt = this.now();
    this.log(
      active,
      LogLevel.ERROR,
      attempt.failedStep,
      `${FailureReason[reason].toLowerCase()}: ${detail}`,
      {
        reason: FailureReason[reason].toLowerCase(),
      },
    );
    this.setState(active, RunState.FAILED);
    this.pump();
    this.emitQueue();
  }

  private pause(active: Active): void {
    const { run } = active;
    // Pause takes a checkpoint, then releases the GPUs (A§3.7).
    active.epoch += 1;
    active.checkpoint = { ...active.position };
    const attempt = this.attempt(active);
    attempt.hasCheckpoint = true;
    attempt.checkpointEpoch = active.epoch;
    this.emitProgress(active, {
      case: "checkpoint",
      value: { attempt: attempt.number, epoch: active.epoch },
    });
    this.release(run);
    this.endAttempt(active);
    this.log(
      active,
      LogLevel.INFO,
      "",
      "Paused after a checkpoint; GPUs released",
    );
    this.setState(active, RunState.PAUSED);
    this.pump();
    this.emitQueue();
  }

  /** Re-queues from the last checkpoint as a new attempt (D141). */
  private resume(active: Active): void {
    const { run } = active;
    active.position = active.checkpoint ?? { step: 0, iteration: 0 };
    for (const [i, node] of active.order.entries()) {
      const status = run.steps.find((s) => s.nodeId === node.id);
      if (
        status &&
        i >= active.position.step &&
        status.state !== StepState.COMPLETED
      ) {
        status.state = StepState.PENDING;
      }
    }
    run.finishedAt = undefined;
    run.attempts.push(this.newAttempt(run.attempts.length + 1));
    this.queue.push(run.id);
    this.setState(active, RunState.QUEUED);
    this.pump();
    this.emitQueue();
  }

  private cancel(run: Run, active: Active | undefined): void {
    const finish = () => {
      if (active) {
        this.context.clock.cancel(active.timer);
        this.endAttempt(active);
        this.active.delete(run.id);
      }
      this.queue = this.queue.filter((id) => id !== run.id);
      this.release(run);
      run.finishedAt = this.now();
      run.state = RunState.CANCELLED;
      if (run.attempts.length) run.attempts.at(-1)!.state = RunState.CANCELLED;
      this.emitRun(run);
      this.pump();
      this.emitQueue();
    };
    if (run.state === RunState.RUNNING && active) {
      // Cancel token, then SIGTERM, then SIGKILL (A§14.1).
      this.context.clock.cancel(active.timer);
      active.timer = this.context.clock.after(KILL_DELAY_MS, finish);
      this.log(active, LogLevel.WARNING, "", "Cancelling: stop requested");
    } else {
      finish();
    }
  }

  /** "mixed builds" when attempts differ in build (D130); reproducibility. */
  private updateTags(run: Run): void {
    const started = run.attempts.filter((a) => a.hardware);
    const builds = new Set(started.map((a) => a.engineBuild));
    const models = new Set(started.map((a) => a.hardware?.gpuModel));
    if (builds.size > 1 && !run.tags.includes(ProvenanceTag.MIXED_BUILDS)) {
      run.tags.push(ProvenanceTag.MIXED_BUILDS);
    }
    run.reproducibility =
      run.mode === DeterminismMode.DETERMINISTIC &&
      builds.size <= 1 &&
      models.size <= 1
        ? ReproducibilityClass.BITWISE
        : ReproducibilityClass.TOLERANCE;
  }

  // Events.

  private log(
    active: Active,
    level: LogLevel,
    nodeId: string,
    message: string,
    fields: Record<string, string> = {},
  ): void {
    this.emitProgress(active, {
      case: "log",
      value: { time: this.now(), level, rank: 0, nodeId, message, fields },
    });
  }

  private publish(runId: string, event: RunEvent, keep: boolean): void {
    if (keep) {
      const held = this.backlog.get(runId) ?? [];
      held.push(event);
      if (held.length > BACKLOG) held.splice(0, held.length - BACKLOG);
      this.backlog.set(runId, held);
    }
    for (const listener of this.runListeners.get(runId) ?? []) listener(event);
  }

  private emitProgress(active: Active, event: RunEventInit): void {
    this.publish(
      active.run.id,
      create(RunEventSchema, { runId: active.run.id, time: this.now(), event }),
      true,
    );
  }

  /** A state change: the Run snapshot, and the queue (D106). */
  emitRun(run: Run): void {
    this.publish(
      run.id,
      create(RunEventSchema, {
        runId: run.id,
        time: this.now(),
        event: { case: "run", value: run },
      }),
      false,
    );
    const attempt = run.attempts.at(-1);
    this.emitQueueEvent({
      case: "runState",
      value: {
        runId: run.id,
        projectId: run.projectId,
        studyId: run.studyId,
        state: run.state,
        failure: attempt?.failure ?? FailureReason.UNSPECIFIED,
        attempt: attempt?.number ?? 0,
      },
    });
    this.emitQueue();
  }

  emitQueue(): void {
    for (const [index, id] of this.queue.entries()) {
      const run = this.run(id);
      if (run) run.queuePosition = index + 1;
    }
    for (const run of this.runs) {
      if (!this.queue.includes(run.id)) run.queuePosition = 0;
    }
    this.emitQueueEvent({
      case: "entries",
      value: { entries: this.entries() },
    });
    this.emitQueueEvent({ case: "summary", value: this.summary() });
  }

  private emitQueueEvent(event: QueueEventInit): void {
    const message = create(QueueEventSchema, { event });
    for (const listener of this.queueListeners) listener(message);
  }
}
