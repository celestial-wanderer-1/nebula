import { Link } from "react-router";

/** An area that a later phase of docs/UI.md Section 8 delivers. */
export function Placeholder({
  title,
  phase,
  main = false,
}: {
  title: string;
  phase: string;
  main?: boolean;
}) {
  const body = (
    <section className="placeholder">
      <h1>{title}</h1>
      <p className="muted">This area arrives in phase {phase}.</p>
    </section>
  );
  return main ? <main className="page">{body}</main> : body;
}

export function NotFound({ main = true }: { main?: boolean }) {
  const body = (
    <section className="placeholder">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Back to projects</Link>
      </p>
    </section>
  );
  return main ? <main className="page">{body}</main> : body;
}
