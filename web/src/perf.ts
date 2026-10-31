// Performance spans for large meshes and payloads (docs/UI.md P7, D161):
// how long until data is on screen. They appear in the browser's
// performance timeline as measures, and e2e/perf.spec.ts reads them.

/** From the editor's tessellation request to its meshes drawn. */
export const GEOMETRY_DRAW = "nebula:geometry-draw";
/** From a view payload received to the viewer drawn. */
export const VIEW_DRAW = "nebula:view-draw";

interface Span {
  start: number;
  /** When the data arrived, for spans that start at the request. */
  received?: number;
}

const spans = new Map<string, Span>();

/** Starts (or restarts) the span `name`. */
export function startSpan(name: string): void {
  spans.set(name, { start: performance.now() });
}

/** Notes that the data of the open span `name` has arrived. */
export function spanReceived(name: string): void {
  const span = spans.get(name);
  if (span) span.received = performance.now();
}

/**
 * Ends the span `name`, if one is open, as a performance measure. With
 * `shownSince`, when what was drawn last changed, it ends only once that
 * is the arrived data, not what was on screen while it loaded.
 */
export function endSpan(
  name: string,
  detail?: Record<string, unknown>,
  shownSince?: number,
): void {
  const span = spans.get(name);
  if (!span) return;
  if (
    shownSince !== undefined &&
    (span.received === undefined || shownSince < span.received)
  ) {
    return;
  }
  spans.delete(name);
  // jsdom lacks User Timing measures with options.
  if (typeof performance.measure !== "function") return;
  performance.measure(name, {
    start: span.start,
    end: performance.now(),
    detail,
  });
}
