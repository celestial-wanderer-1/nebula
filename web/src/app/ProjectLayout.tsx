import { NavLink, Outlet, useParams } from "react-router";
import { useEntityChannel } from "../ws/channels";
import { PROJECT_AREAS } from "./areas";

/** A project's left navigation and pages. Keeps the entity channel open. */
export function ProjectLayout() {
  const { projectId = "" } = useParams();
  useEntityChannel(projectId);
  const base = `/p/${encodeURIComponent(projectId)}`;
  return (
    <div className="project-layout">
      <nav className="sidenav" aria-label="Project">
        <NavLink to={base} end>
          Overview
        </NavLink>
        {PROJECT_AREAS.map((area) => (
          <NavLink key={area.path} to={`${base}/${area.path}`}>
            {area.label}
          </NavLink>
        ))}
      </nav>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
