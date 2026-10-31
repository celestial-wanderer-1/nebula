import { Link, useParams } from "react-router";
import { errorMessage } from "../../api/errors";
import { useRuns } from "../../api/runs";
import { useStudy, useStudyAction } from "../../api/studies";
import { shortHash } from "../../entities/references";
import { RUN_STATE_LABELS } from "../../entities/runLabels";
import { RunStaleness } from "../../entities/RunStaleness";
import { RunState } from "../../gen/nebula/core/v1/run_pb";
import { StudyState } from "../../gen/nebula/core/v1/study_pb";

const STUDY_STATES: Record<StudyState, string> = {
  [StudyState.UNSPECIFIED]: "—",
  [StudyState.DRAFT]: "Not started",
  [StudyState.RUNNING]: "Running",
  [StudyState.STOPPED]: "Stopped",
  [StudyState.COMPLETED]: "Completed",
};

const METRICS: [string, string][] = [
  ["q95", "q95"],
  ["betaPoloidal", "β poloidal"],
];

const format = (value: number) =>
  Math.abs(value) >= 1e4 || (Math.abs(value) < 1e-2 && value !== 0)
    ? value.toExponential(3)
    : value.toPrecision(4);

/**
 * A scan's points (docs/UI.md 6.9): one row per point Run with its override
 * vector, state, staleness and key metrics, linked to the Run (D109).
 */
export function StudyDetail() {
  const { projectId = "", studyId = "" } = useParams();
  const study = useStudy(projectId, studyId);
  const runs = useRuns(projectId);
  const action = useStudyAction(projectId, studyId);
  if (!study.data) {
    return study.error ? (
      <p className="field-error" role="alert">
        {study.error.message}
      </p>
    ) : (
      <p className="muted">Loading study…</p>
    );
  }
  const s = study.data;
  const done = s.points.filter((p) => p.state === RunState.COMPLETED).length;
  const active = s.points.filter(
    (p) =>
      p.state === RunState.QUEUED ||
      p.state === RunState.PREPARING ||
      p.state === RunState.RUNNING,
  ).length;
  return (
    <section className="study-detail">
      <div className="page-header">
        <h1>{s.name}</h1>
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={
              s.state === StudyState.RUNNING ||
              s.state === StudyState.COMPLETED ||
              action.isPending
            }
            onClick={() => action.mutate("start")}
          >
            Start
          </button>
          <button
            type="button"
            disabled={s.state !== StudyState.RUNNING || action.isPending}
            onClick={() => action.mutate("stop")}
          >
            Stop
          </button>
        </div>
      </div>
      <p role="status" aria-label="Study progress">
        {STUDY_STATES[s.state]}: {done} of {s.points.length} points completed,{" "}
        {active} active (at most {s.concurrency}).
      </p>
      <p className="muted small">
        Base workflow version <code>{shortHash(s.workflowVersionHash)}</code>,{" "}
        {s.gpusPerRun} GPU
        {s.gpusPerRun === 1 ? "" : "s"} per run.
      </p>
      {action.error && (
        <p className="field-error" role="alert">
          {errorMessage(action.error)}
        </p>
      )}
      <table className="table" aria-label="Points">
        <thead>
          <tr>
            <th scope="col">#</th>
            {s.variables.map((v) => (
              <th key={v.path} scope="col">
                {v.label}
                {v.unit && <span className="unit"> [{v.unit}]</span>}
              </th>
            ))}
            <th scope="col">Run</th>
            <th scope="col">State</th>
            {METRICS.map(([, label]) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {s.points.map((point) => {
            const run = runs.data?.find((r) => r.id === point.runId);
            return (
              <tr
                key={point.index}
                data-point={point.index}
                data-state={RunState[point.state]}
              >
                <th scope="row">{point.index + 1}</th>
                {s.variables.map((v) => (
                  <td key={v.path}>
                    {format(point.overrides?.values[v.path] ?? 0)}
                  </td>
                ))}
                <td>
                  {point.runId ? (
                    <Link
                      to={`/p/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(point.runId)}`}
                    >
                      {point.runId}
                    </Link>
                  ) : (
                    <span className="muted">not started</span>
                  )}
                  {run && <RunStaleness run={run} compact />}
                </td>
                <td>{point.runId ? RUN_STATE_LABELS[point.state] : "—"}</td>
                {METRICS.map(([key]) => (
                  <td key={key}>
                    {point.metrics[key] !== undefined
                      ? format(point.metrics[key])
                      : "—"}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
