import type { FieldViolation } from "../gen/nebula/core/v1/errors_pb";
import { SAVE_STATUS_LABELS, type DraftStatus } from "./useDraft";

/** The save-status line of a draft editor. */
export function SaveStatus({ status }: { status: DraftStatus }) {
  return (
    <output
      className="draft-status"
      aria-label="Save status"
      data-status={status}
    >
      {SAVE_STATUS_LABELS[status]}
    </output>
  );
}

/**
 * Server violations of a draft save that no field of the editor shows
 * inline, so a rejected save always says why (docs/UI.md Section 5).
 */
export function DraftViolations({
  violations,
  describe = (path) => path,
}: {
  violations: readonly FieldViolation[];
  /** A readable name of a field path. */
  describe?: (path: string) => string;
}) {
  if (violations.length === 0) return null;
  return (
    <div className="field-error" role="alert">
      <p>Not saved; the server rejected:</p>
      <ul>
        {violations.map((violation, index) => (
          <li key={index}>
            {describe(violation.path)}: {violation.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
