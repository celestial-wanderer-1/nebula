import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { EntityKind } from "../gen/nebula/core/v1/entity_pb";
import {
  DeterminismMode,
  RunAction,
  RunState,
  type Run,
} from "../gen/nebula/core/v1/run_pb";
import {
  StudySchema,
  StudyState,
  type CreateStudyRequest,
  type Study,
  type StudyVariable,
} from "../gen/nebula/core/v1/study_pb";
import { isTerminal } from "./runs/engine";
import { submitPoint } from "./runs/service";
import type { MockStore, StoreResult } from "./store";

// Parameter-scan Studies (A§12.4, D109, D142): one point Run per override
// vector of the cartesian product of the variables, from the pinned base
// Workflow version, at most `concurrency` active at a time.

const fail = <T>(status: number, message: string): StoreResult<T> => ({
  ok: false,
  status,
  code: "invalid",
  message,
});

/** The values of one variable. */
export function variableValues(variable: StudyVariable): number[] {
  switch (variable.values.case) {
    case "range": {
      const { min, max, count } = variable.values.value;
      if (count <= 1) return [min];
      return Array.from(
        { length: count },
        (_, i) => min + ((max - min) * i) / (count - 1),
      );
    }
    case "points":
      return [...variable.values.value.values];
    default:
      return [];
  }
}

/** Every combination of the variables' values, first variable slowest. */
export function cartesian(
  variables: readonly StudyVariable[],
): Record<string, number>[] {
  return variables.reduce<Record<string, number>[]>(
    (points, variable) =>
      points.flatMap((point) =>
        variableValues(variable).map((value) => ({
          ...point,
          [variable.path]: value,
        })),
      ),
    [{}],
  );
}

const METRICS = ["q95", "betaPoloidal"] as const;

export class StudyService {
  private studies: { projectId: string; study: Study }[] = [];
  private next = 1;
  /** Submitting a point emits its state change; that must not re-enter. */
  private pumping = false;

  constructor(private readonly store: MockStore) {}

  clear(): void {
    this.studies = [];
    this.next = 1;
  }

  list(projectId: string): Study[] {
    return this.studies
      .filter((s) => s.projectId === projectId)
      .map((s) => s.study);
  }

  get(projectId: string, id: string): Study | undefined {
    return this.list(projectId).find((s) => s.id === id);
  }

  create(
    projectId: string,
    request: Omit<CreateStudyRequest, "$typeName">,
  ): StoreResult<Study> {
    const workflow = this.store.entity(
      projectId,
      EntityKind.WORKFLOW,
      request.workflowId,
    );
    if (!workflow) return fail(404, "Workflow not found");
    if (
      !workflow.versions.some((v) => v.hash === request.workflowVersionHash)
    ) {
      return fail(422, "A scan runs a pinned workflow version (D109)");
    }
    if (request.variables.length === 0)
      return fail(422, "Choose at least one variable");
    const combinations = cartesian(request.variables);
    if (combinations.length === 0)
      return fail(422, "The variables have no values");
    const study = create(StudySchema, {
      id: `std-${this.next++}`,
      name: request.name || `Scan of ${workflow.draft.name}`,
      workflowId: request.workflowId,
      workflowVersionHash: request.workflowVersionHash,
      variables: request.variables,
      concurrency: request.concurrency || this.store.queue.gpusTotal,
      gpusPerRun: request.gpusPerRun || 1,
      mode: request.mode || DeterminismMode.DETERMINISTIC,
      state: StudyState.DRAFT,
      createdAt: timestampFromMs(this.store.clock.now()),
      points: combinations.map((values, index) => ({
        index,
        overrides: { values },
      })),
    });
    this.studies.push({ projectId, study });
    return { ok: true, value: study };
  }

  start(projectId: string, id: string): StoreResult<Study> {
    const study = this.get(projectId, id);
    if (!study) return fail(404, "Study not found");
    if (
      study.state !== StudyState.DRAFT &&
      study.state !== StudyState.STOPPED
    ) {
      return fail(409, "The study is already running or done");
    }
    study.state = StudyState.RUNNING;
    this.pump(projectId, study);
    return { ok: true, value: study };
  }

  stop(projectId: string, id: string): StoreResult<Study> {
    const study = this.get(projectId, id);
    if (!study) return fail(404, "Study not found");
    study.state = StudyState.STOPPED;
    for (const point of study.points) {
      const run = point.runId ? this.store.engine.run(point.runId) : undefined;
      if (run && !isTerminal(run.state))
        this.store.engine.action(run.id, RunAction.CANCEL);
    }
    this.refresh(study);
    return { ok: true, value: study };
  }

  /** A point Run changed state: record it and start the next points. */
  onRunState(run: Run): void {
    const entry = this.studies.find((s) => s.study.id === run.studyId);
    if (!entry || this.pumping) return;
    this.refresh(entry.study);
    if (entry.study.state === StudyState.RUNNING)
      this.pump(entry.projectId, entry.study);
  }

  /** Point states and metrics from their Runs. */
  private refresh(study: Study): void {
    for (const point of study.points) {
      const run = point.runId ? this.store.engine.run(point.runId) : undefined;
      if (!run) continue;
      point.state = run.state;
      if (run.state === RunState.COMPLETED) {
        const scalars = this.store
          .runOutputs(run.id)
          .find((o) => o.name === "scalars")?.scalars;
        const values = scalars && this.store.unpackScalars(scalars);
        for (const metric of METRICS) {
          const value = values?.[metric];
          if (typeof value === "number") point.metrics[metric] = value;
        }
      }
    }
    if (
      study.state === StudyState.RUNNING &&
      study.points.every((p) => p.runId && isTerminal(p.state))
    ) {
      study.state = StudyState.COMPLETED;
    }
  }

  /** Starts point Runs up to the concurrency limit (D142). */
  private pump(projectId: string, study: Study): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const active = () =>
        study.points.filter((p) => p.runId && !isTerminal(p.state)).length;
      for (const point of study.points) {
        if (active() >= study.concurrency) break;
        if (point.runId) continue;
        const run = submitPoint(this.store, projectId, study, point);
        if (!run) break;
        point.runId = run.id;
        point.state = run.state;
      }
    } finally {
      this.pumping = false;
    }
    this.refresh(study);
  }
}
