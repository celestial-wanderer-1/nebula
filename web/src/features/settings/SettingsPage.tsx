import * as Switch from "@radix-ui/react-switch";
import { useId } from "react";
import { errorMessage } from "../../api/errors";
import { useProjects } from "../../api/projects";
import { useSettings, useUpdateProjectSettings } from "../../api/settings";
import type { Project } from "../../gen/nebula/core/v1/project_pb";

function StrictCache({ project }: { project: Project }) {
  const id = useId();
  const update = useUpdateProjectSettings(project.id);
  const checked = update.isPending
    ? Boolean(update.variables?.strictCache)
    : Boolean(project.settings?.strictCache);
  return (
    <tr>
      <th scope="row">
        <label htmlFor={id}>{project.name}</label>
      </th>
      <td>
        <Switch.Root
          id={id}
          className="switch"
          checked={checked}
          disabled={update.isPending}
          onCheckedChange={(strictCache) =>
            update.mutate({ ...project.settings, strictCache })
          }
        >
          <Switch.Thumb className="switch-thumb" />
        </Switch.Root>
        {update.error && (
          <span className="field-error" role="alert">
            {errorMessage(update.error)}
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * The installation's TOML configuration, read-only (D90), and the
 * per-project strict cache switch: no cache hits from other hardware
 * (D78, D125).
 */
export function SettingsPage() {
  const settings = useSettings();
  const projects = useProjects();
  return (
    <main className="page settings-page">
      <h1>Settings</h1>
      <section className="panel" aria-label="Configuration">
        <h2>Configuration</h2>
        <p className="muted small">
          {settings.data?.configPath}: edit the file and restart{" "}
          <code>nebula serve</code> to change it.
        </p>
        <pre className="raw-json" tabIndex={0} aria-label="Configuration file">
          {settings.data?.toml}
        </pre>
      </section>
      <section className="panel" aria-label="Strict cache">
        <h2>Strict cache per project</h2>
        <p className="muted small">
          A strict project never reuses a cached result produced on other
          hardware.
        </p>
        <table className="table">
          <tbody>
            {projects.data?.map((project) => (
              <StrictCache key={project.id} project={project} />
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
