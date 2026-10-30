import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Link, Outlet, useNavigate, useParams } from "react-router";
import { usePlugins } from "../api/plugins";
import { useProjects } from "../api/projects";
import { SmokeResult } from "../gen/nebula/core/v1/plugin_pb";
import { useQueueSummary, useTelemetry } from "../ws/channels";

function ProjectSwitcher() {
  const { projectId } = useParams();
  const projects = useProjects();
  const navigate = useNavigate();
  const current = projects.data?.find((project) => project.id === projectId);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="switcher" aria-label="Switch project">
        {current?.name ?? "Projects"} ▾
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align="start" sideOffset={4}>
          {projects.data?.map((project) => (
            <DropdownMenu.Item
              key={project.id}
              className="menu-item"
              onSelect={() => navigate(`/p/${encodeURIComponent(project.id)}`)}
            >
              {project.name}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="menu-separator" />
          <DropdownMenu.Item
            className="menu-item"
            onSelect={() => navigate("/")}
          >
            All projects
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Queue counts (D102) and GPU use (D44), shared across projects. */
export function QueueIndicator() {
  const queue = useQueueSummary();
  const telemetry = useTelemetry();
  const busy =
    telemetry?.gpus.filter((gpu) => gpu.runId !== "").length ?? queue?.gpusBusy;
  const total = telemetry?.gpus.length ?? queue?.gpusTotal;
  return (
    <div className="indicator" role="status" aria-label="Queue">
      {queue ? (
        <>
          <span>{queue.running} running</span>
          <span>{queue.preparing + queue.queued} queued</span>
        </>
      ) : (
        <span className="muted">Queue…</span>
      )}
      {total !== undefined && (
        <span>
          GPUs {busy ?? 0}/{total}
        </span>
      )}
    </div>
  );
}

/** Installed plugins, warning on any failed smoke V&V (D61, D140). */
export function PluginStatus() {
  const plugins = usePlugins();
  const failing =
    plugins.data?.filter((plugin) =>
      plugin.smoke.some((s) => s.result === SmokeResult.FAILED),
    ) ?? [];
  if (!plugins.data) return null;
  return (
    <Link
      to="/plugins"
      className={failing.length ? "indicator warn" : "indicator"}
      title={failing.map((p) => `${p.id} ${p.version}`).join(", ") || undefined}
    >
      {plugins.data.length} plugins
      {failing.length > 0 && (
        <span>
          {" "}
          · {failing.length} smoke failure{failing.length > 1 ? "s" : ""}
        </span>
      )}
    </Link>
  );
}

export function Shell() {
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          Nebula
        </Link>
        <ProjectSwitcher />
        <div className="spacer" />
        <QueueIndicator />
        <PluginStatus />
      </header>
      <div className="shell-body">
        <Outlet />
      </div>
    </div>
  );
}
