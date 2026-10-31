import { Link } from "react-router";
import { useRuns } from "../../api/runs";
import { formatTime } from "../../entities/format";
import { ProvenanceTags } from "../../entities/ProvenanceTags";
import { RunStaleness } from "../../entities/RunStaleness";
import { RunStateBadge } from "../../entities/RunStateBadge";
import { DeterminismMode } from "../../gen/nebula/core/v1/run_pb";
import { runPath } from "./paths";

/** The project's Runs, newest first (docs/UI.md 6.6). */
export function RunList({ projectId }: { projectId: string }) {
  const runs = useRuns(projectId);
  if (runs.isPending) return <p className="muted">Loading runs…</p>;
  if (runs.error) {
    return (
      <p className="field-error" role="alert">
        {runs.error.message}
      </p>
    );
  }
  if (runs.data.length === 0) {
    return (
      <p className="muted">No runs yet. Submit one from a workflow’s editor.</p>
    );
  }
  return (
    <table className="table" aria-label="Runs">
      <thead>
        <tr>
          <th scope="col">Run</th>
          <th scope="col">State</th>
          <th scope="col">GPUs</th>
          <th scope="col">Mode</th>
          <th scope="col">Submitted</th>
          <th scope="col">Tags</th>
        </tr>
      </thead>
      <tbody>
        {runs.data.map((run) => (
          <tr key={run.id} data-run={run.id}>
            <th scope="row">
              <Link to={runPath(projectId, run.id)}>{run.name || run.id}</Link>
            </th>
            <td>
              <RunStateBadge run={run} />
            </td>
            <td>{run.gpus || "—"}</td>
            <td>
              {run.mode === DeterminismMode.FAST ? "fast" : "deterministic"}
            </td>
            <td>{formatTime(run.submittedAt)}</td>
            <td>
              <ProvenanceTags tags={run.tags} />
              <RunStaleness run={run} compact />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
