import {
  Component as ReactComponent,
  lazy,
  Suspense,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

/**
 * A lazily loaded heavy view (three.js, vtk.js, Plotly, React Flow), so
 * each library is its own chunk fetched only where it is used (docs/UI.md
 * P7). A chunk that fails to load (a rebuilt server, a dropped connection)
 * costs only that view, never the page around it; a retry loads it afresh,
 * since `lazy` keeps a failed import.
 */
export function lazyView<Props extends object>(
  load: () => Promise<ComponentType<Props>>,
  {
    loading,
    unavailable,
    className = "viewport",
  }: { loading: string; unavailable: string; className?: string },
): ComponentType<Props> {
  // Cast: a generic LazyExoticComponent does not type-check as JSX.
  const make = () =>
    lazy(() =>
      load().then((component) => ({ default: component })),
    ) as unknown as ComponentType<Props>;
  let Lazy = make();

  return function LazyView(props: Props) {
    const [attempt, setAttempt] = useState(0);
    return (
      <LoadBoundary
        key={attempt}
        className={className}
        message={unavailable}
        onRetry={() => {
          Lazy = make();
          setAttempt((n) => n + 1);
        }}
      >
        <Suspense fallback={<p className={`${className} muted`}>{loading}</p>}>
          <Lazy {...props} />
        </Suspense>
      </LoadBoundary>
    );
  };
}

class LoadBoundary extends ReactComponent<
  {
    className: string;
    message: string;
    onRetry: () => void;
    children: ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <div className={`${this.props.className} viewport-fallback`} role="note">
        <p className="muted">{this.props.message}</p>
        <button type="button" onClick={this.props.onRetry}>
          Retry
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
