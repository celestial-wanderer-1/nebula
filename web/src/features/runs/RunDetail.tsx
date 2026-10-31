import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { NotFoundError } from "../../api/errors";
import { useRun, useRunOutputs } from "../../api/runs";
import { formatTime } from "../../entities/format";
import { ProvenanceTags } from "../../entities/ProvenanceTags";
import { shortHash } from "../../entities/references";
import { RunActionsBar } from "../../entities/RunActionsBar";
import { RunStaleness } from "../../entities/RunStaleness";
import { RUN_STATE_LABELS } from "../../entities/runLabels";
import { RunStateBadge } from "../../entities/RunStateBadge";
import {
  DeterminismClass,
  DeterminismMode,
  FailureReason,
  ReproducibilityClass,
  StepState,
  type Run,
} from "../../gen/nebula/core/v1/run_pb";
import { useRunChannel, useTelemetry } from "../../ws/channels";
import { useRunProgress } from "../../ws/runProgress";
import { LogView } from "./LogView";
import { ProvenancePanel } from "./ProvenancePanel";
import { ResidualPlot } from "./ResidualPlot";
import { runPath } from "./paths";

const STEP_STATES: Readonly<Record<StepState, string>> = {
  [StepState.UNSPECIFIED]: "—",
  [StepState.PENDING]: "Pending",
  [StepState.CACHED]: "Cached",
  [StepState.RUNNING]: "Running",
  [StepState.COMPLETED]: "Completed",
  [StepState.FAILED]: "Failed",
};

const duration = (from?: Run["startedAt"], to?: Run["finishedAt"]) => {
  if (!from || !to) return "";
  const s = Math.round(
    (timestampDate(to).getTime() - timestampDate(from).getTime()) / 1000,
  );
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

/**
 * One Run (docs/UI.md 6.6): state and actions, attempts with build,
 * hardware and achieved determinism (D129, D130), steps with cache
 * producers (D125), provenance (A§4.3), live logs and residuals (A§3.5,
 * D44), GPU telemetry and committed outputs (D122).
 */
export function RunDetail() {
  const { projectId = "", runId = "" } = useParams();
  useRunChannel(projectId, runId);
  const run = useRun(projectId, runId);
  const outputs = useRunOutputs(projectId, runId);
  const progress = useRunProgress(runId);
  const telemetry = useTelemetry();
  const labels = useMemo(
    () => new Map(run.data?.steps.map((s) => [s.nodeId, s.label]) ?? []),
    [run.data?.steps],
  );

  if (!run.data) {
    if (run.error instanceof NotFoundError) {
      return (
        <section className="placeholder">
          <h1>Run not found</h1>
          <p>
            <Link to=".." relative="path">
              Back to runs
            </Link>
          </p>
        </section>
      );
    }
    return run.error ? (
      <p className="field-error" role="alert">
        {run.error.message}
      </p>
    ) : (
      <p className="muted">Loading run…</p>
    );
  }
  const r = run.data;
  const attempt = r.attempts.at(-1);
  const gpus = telemetry?.gpus.filter((gpu) => gpu.runId === r.id) ?? [];

  return (
    <section className="run-page">
      <div className="page-header">
        <h1>{r.name || r.id}</h1>
      </div>
      <div className="run-header" role="group" aria-label="Run state">
        <RunStateBadge run={r} />
        <ProvenanceTags tags={r.tags} />
        <span className="muted">
          {r.gpus} GPU{r.gpus === 1 ? "" : "s"} ·{" "}
          {r.mode === DeterminismMode.FAST ? "fast" : "deterministic"}
          {r.reproducibility === ReproducibilityClass.TOLERANCE &&
            " · within tolerances"}
          {r.reproducibility === ReproducibilityClass.BITWISE && " · bitwise"}
          {r.queuePosition > 0 && ` · position ${r.queuePosition} in the queue`}
        </span>
        <RunStaleness run={r} />
        {r.rerunOf && (
          <span className="muted">
            Re-run of{" "}
            <Link to={runPath(projectId, r.rerunOf)}>{r.rerunOf}</Link>
          </span>
        )}
      </div>
      {attempt?.failure ? (
        <p className="field-error" role="alert">
          Attempt {attempt.number} failed (
          {FailureReason[attempt.failure].toLowerCase()}):{" "}
          {attempt.failureDetail}
          {attempt.failedStep &&
            ` in step ${labels.get(attempt.failedStep) ?? attempt.failedStep}`}
          {attempt.failedRank !== undefined && `, rank ${attempt.failedRank}`}.{" "}
          {attempt.hasCheckpoint
            ? `Checkpoint epoch ${attempt.checkpointEpoch} is committed.`
            : "No checkpoint was committed."}
        </p>
      ) : null}
      <RunActionsBar run={r} />

      <div className="run-grid">
        <section className="panel" aria-label="Timeline">
          <h2>Timeline</h2>
          <ol className="timeline">
            <li>Submitted {formatTime(r.submittedAt)}</li>
            {r.attempts.map((a) => (
              <li key={a.number}>
                Attempt {a.number}: {RUN_STATE_LABELS[a.state]}
                {a.startedAt && ` · started ${formatTime(a.startedAt)}`}
                {a.endedAt && ` · ended ${formatTime(a.endedAt)}`}
              </li>
            ))}
            {r.finishedAt && (
              <li>
                {RUN_STATE_LABELS[r.state]} {formatTime(r.finishedAt)}{" "}
                <span className="muted">
                  {duration(r.startedAt ?? r.submittedAt, r.finishedAt)}
                </span>
              </li>
            )}
          </ol>
        </section>

        <section className="panel" aria-label="Steps">
          <h2>Steps</h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Step</th>
                <th scope="col">State</th>
                <th scope="col">Ranks</th>
                <th scope="col">Iteration</th>
              </tr>
            </thead>
            <tbody>
              {r.steps.map((step) => (
                <tr
                  key={step.nodeId}
                  data-step={step.nodeId}
                  data-state={StepState[step.state]}
                >
                  <th scope="row">{step.label}</th>
                  <td>
                    {STEP_STATES[step.state]}
                    {step.cacheProducerRunId && (
                      <>
                        {" "}
                        from{" "}
                        <Link to={runPath(projectId, step.cacheProducerRunId)}>
                          {step.cacheProducerRunId}
                        </Link>
                      </>
                    )}
                  </td>
                  <td>{step.ranks || ""}</td>
                  <td>{step.iteration || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel" aria-label="Attempts">
          <h2>Attempts</h2>
          {r.attempts.length === 0 && (
            <p className="muted small">None: every step came from the cache.</p>
          )}
          {r.attempts.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">State</th>
                  <th scope="col">Build</th>
                  <th scope="col">Hardware</th>
                  <th scope="col">Determinism</th>
                </tr>
              </thead>
              <tbody>
                {r.attempts.map((a) => (
                  <tr key={a.number}>
                    <th scope="row">{a.number}</th>
                    <td>
                      {RUN_STATE_LABELS[a.state]}
                      {a.failure
                        ? ` (${FailureReason[a.failure].toLowerCase()})`
                        : ""}
                    </td>
                    <td>
                      <code>{a.engineBuild}</code>
                    </td>
                    <td>
                      {a.hardware
                        ? `${a.hardware.gpuCount} × ${a.hardware.vendor} ${a.hardware.gpuModel}`
                        : "—"}
                    </td>
                    <td>
                      {a.achieved === DeterminismClass.DETERMINISTIC
                        ? "deterministic"
                        : a.achieved === DeterminismClass.NONDETERMINISTIC
                          ? "nondeterministic"
                          : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel" aria-label="Convergence">
          <h2>Convergence</h2>
          <ResidualPlot residuals={progress.residuals} labels={labels} />
          {gpus.length > 0 && (
            <ul className="gpu-list" aria-label="GPU telemetry">
              {gpus.map((gpu) => (
                <li key={gpu.gpuIndex}>
                  GPU {gpu.gpuIndex} ({gpu.model}):{" "}
                  {Math.round(gpu.utilization * 100)}% ·{" "}
                  {(Number(gpu.memoryUsedBytes) / 2 ** 30).toFixed(0)} /{" "}
                  {(Number(gpu.memoryTotalBytes) / 2 ** 30).toFixed(0)} GiB
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel" aria-label="Outputs">
          <h2>Outputs</h2>
          {outputs.data?.length === 0 && (
            <p className="muted small">No outputs committed yet.</p>
          )}
          {outputs.data && outputs.data.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Output</th>
                  <th scope="col">Sub-contract</th>
                  <th scope="col">Hash</th>
                </tr>
              </thead>
              <tbody>
                {outputs.data.map((output) => (
                  <tr key={`${output.nodeId}/${output.name}`}>
                    <th scope="row">
                      {labels.get(output.nodeId) ?? output.nodeId} ·{" "}
                      {output.name}
                      {output.producerRunId && (
                        <span className="muted small">
                          {" "}
                          (cached from {output.producerRunId})
                        </span>
                      )}
                    </th>
                    <td>{output.subContract}</td>
                    <td>
                      <code title={output.contentHash}>
                        {shortHash(output.contentHash)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel" aria-label="Provenance">
          <h2>Provenance</h2>
          <ProvenancePanel provenance={r.provenance} />
        </section>
      </div>

      <LogView
        logs={progress.logs}
        dropped={progress.droppedLogs}
        steps={r.steps}
      />
    </section>
  );
}
