import { Link, useParams } from "react-router";
import { NotFoundError } from "../../api/errors";
import { useProject } from "../../api/projects";
import { PROJECT_AREAS } from "../../app/areas";
import { ProvenanceTags } from "../../entities/ProvenanceTags";
import { ProvenanceTag } from "../../gen/nebula/core/v1/run_pb";
import { conceptName, formatTime } from "./format";

export function ProjectOverview() {
  const { projectId = "" } = useParams();
  const project = useProject(projectId);

  if (project.error instanceof NotFoundError) {
    return (
      <section className="placeholder">
        <h1>Project not found</h1>
        <p>
          <Link to="/">Back to projects</Link>
        </p>
      </section>
    );
  }
  if (!project.data) {
    return <p className="muted">{project.error?.message ?? "Loading…"}</p>;
  }
  const p = project.data;
  return (
    <section>
      <h1>{p.name}</h1>
      {p.description && <p>{p.description}</p>}
      <dl className="details">
        <dt>Concept</dt>
        <dd>
          {conceptName(p.concept)}
          {p.concept?.version && ` ${p.concept.version}`}
        </dd>
        <dt>Runs</dt>
        <dd>
          {p.runCount}
          {p.nonReproducibleRunCount > 0 && (
            <>
              {" "}
              ({p.nonReproducibleRunCount}{" "}
              <ProvenanceTags tags={[ProvenanceTag.NOT_REPRODUCIBLE_HERE]} />)
            </>
          )}
        </dd>
        <dt>Created</dt>
        <dd>{formatTime(p.createdAt)}</dd>
        <dt>Updated</dt>
        <dd>{formatTime(p.updatedAt)}</dd>
      </dl>
      <h2>Areas</h2>
      <ul className="area-links">
        {PROJECT_AREAS.map((area) => (
          <li key={area.path}>
            <Link to={area.path}>{area.label}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
