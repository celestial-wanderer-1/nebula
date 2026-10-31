import { Link, useParams } from "react-router";
import { useRuns } from "../../api/runs";
import { formatTime } from "../../entities/format";
import { RunStateBadge } from "../../entities/RunStateBadge";
import { RunState } from "../../gen/nebula/core/v1/run_pb";

/** Runs whose outputs can be viewed: completed ones and live ones (D122). */
export function ResultsPage() {
  const { projectId = "" } = useParams();
  const runs = useRuns(projectId);
  const viewable =
    runs.data?.filter((run) =>
      [
        RunState.COMPLETED,
        RunState.RUNNING,
        RunState.PAUSED,
        RunState.FAILED,
      ].includes(run.state),
    ) ?? [];
  return (
    <section>
      <h1>Results</h1>
      {runs.isPending && <p className="muted">Loading runs…</p>}
      {runs.data && viewable.length === 0 && (
        <p className="muted">No run has committed outputs yet.</p>
      )}
      {viewable.length > 0 && (
        <table className="table" aria-label="Runs with results">
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">State</th>
              <th scope="col">Finished</th>
            </tr>
          </thead>
          <tbody>
            {viewable.map((run) => (
              <tr key={run.id}>
                <th scope="row">
                  <Link
                    to={`/p/${encodeURIComponent(projectId)}/results/${encodeURIComponent(run.id)}`}
                  >
                    {run.name || run.id}
                  </Link>
                </th>
                <td>
                  <RunStateBadge run={run} />
                </td>
                <td>{run.finishedAt ? formatTime(run.finishedAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
