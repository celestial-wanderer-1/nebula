import {
  Component as ReactComponent,
  lazy,
  Suspense,
  useState,
  type ReactNode,
} from "react";
import type { ViewportProps } from "./Viewport";

// three.js and R3F load with the editor's viewport only (docs/UI.md P7).
const loadViewport = () =>
  lazy(() =>
    import("./Viewport").then((module) => ({ default: module.Viewport })),
  );
let LazyViewport = loadViewport();

/**
 * The lazily loaded viewport. A chunk that fails to load (a rebuilt server,
 * a dropped connection) costs only the 3D view, never the editor around it;
 * a retry loads it afresh, since `lazy` keeps a failed import.
 */
export function ViewportSlot(props: ViewportProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <LoadBoundary
      key={attempt}
      onRetry={() => {
        LazyViewport = loadViewport();
        setAttempt((n) => n + 1);
      }}
    >
      <Suspense fallback={<p className="viewport muted">Loading 3D view…</p>}>
        <LazyViewport {...props} />
      </Suspense>
    </LoadBoundary>
  );
}

class LoadBoundary extends ReactComponent<
  { onRetry: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <div className="viewport viewport-fallback" role="note">
        <p className="muted">
          3D view unavailable: the viewer could not be loaded. Editing still
          works.
        </p>
        <button type="button" onClick={this.props.onRetry}>
          Retry
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
