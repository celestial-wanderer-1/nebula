import { Link, useParams } from "react-router";
import { useStudies } from "../../api/studies";
import { formatTime } from "../../entities/format";
import { RunState } from "../../gen/nebula/core/v1/run_pb";

/** The project's parameter scans (docs/UI.md 6.9). */
export function StudiesPage() {
  const { projectId = "" } = useParams();
  const studies = useStudies(projectId);
  const base = `/p/${encodeURIComponent(projectId)}/studies`;
  return (
    <section>
      <div className="page-header">
        <h1>Studies</h1>
        <div className="actions">
          <Link className="button primary" to={`${base}/new`}>
            New parameter scan
          </Link>
        </div>
      </div>
      {studies.data?.length === 0 && <p className="muted">No studies yet.</p>}
      {studies.data && studies.data.length > 0 && (
        <table className="table" aria-label="Studies">
          <thead>
            <tr>
              <th scope="col">Study</th>
              <th scope="col">Points</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            {studies.data.map((study) => (
              <tr key={study.id}>
                <th scope="row">
                  <Link to={`${base}/${encodeURIComponent(study.id)}`}>
                    {study.name}
                  </Link>
                </th>
                <td>
                  {
                    study.points.filter((p) => p.state === RunState.COMPLETED)
                      .length
                  }{" "}
                  / {study.points.length}
                </td>
                <td>{formatTime(study.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
