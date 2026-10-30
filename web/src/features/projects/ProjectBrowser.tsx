import { useState } from "react";
import { Link } from "react-router";
import { exportProject, useProjects } from "../../api/projects";
import { ProvenanceTags } from "../../entities/ProvenanceTags";
import type { Project } from "../../gen/nebula/core/v1/project_pb";
import { ProvenanceTag } from "../../gen/nebula/core/v1/run_pb";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { conceptName, formatTime } from "./format";
import { ImportDialog } from "./ImportDialog";
import { SaveTemplateDialog } from "./SaveTemplateDialog";

/** Projects of the global registry (D100), with create, import and export. */
export function ProjectBrowser() {
  const projects = useProjects();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [templateFrom, setTemplateFrom] = useState<Project>();
  const [exportError, setExportError] = useState<string>();

  const runExport = (project: Project) => {
    setExportError(undefined);
    exportProject(project).catch((error: unknown) =>
      setExportError(
        `Export of “${project.name}” failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  };

  return (
    <main className="page">
      <div className="page-header">
        <h1>Projects</h1>
        <div className="actions">
          <button type="button" onClick={() => setImporting(true)}>
            Import
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => setCreating(true)}
          >
            New project
          </button>
        </div>
      </div>

      {exportError && (
        <p className="field-error" role="alert">
          {exportError}
        </p>
      )}
      {projects.isPending && <p className="muted">Loading projects…</p>}
      {projects.error && (
        <p className="field-error" role="alert">
          {projects.error.message}
        </p>
      )}
      {projects.data?.length === 0 && (
        <p className="muted">No projects yet. Create one from a concept kit.</p>
      )}
      {projects.data && projects.data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Concept</th>
              <th scope="col">Runs</th>
              <th scope="col">Updated</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {projects.data.map((project) => (
              <tr key={project.id}>
                <th scope="row">
                  <Link to={`/p/${encodeURIComponent(project.id)}`}>
                    {project.name}
                  </Link>
                  {project.nonReproducibleRunCount > 0 && (
                    <ProvenanceTags
                      tags={[ProvenanceTag.NOT_REPRODUCIBLE_HERE]}
                    />
                  )}
                  {project.description && (
                    <div className="muted small">{project.description}</div>
                  )}
                </th>
                <td>{conceptName(project.concept)}</td>
                <td>{project.runCount}</td>
                <td>{formatTime(project.updatedAt)}</td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      aria-label={`Export ${project.name}`}
                      onClick={() => runExport(project)}
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      aria-label={`Save ${project.name} as template`}
                      onClick={() => setTemplateFrom(project)}
                    >
                      Save as template
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
      <ImportDialog open={importing} onOpenChange={setImporting} />
      <SaveTemplateDialog
        project={templateFrom}
        onClose={() => setTemplateFrom(undefined)}
      />
    </main>
  );
}
