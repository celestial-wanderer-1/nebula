import type { EntityRef } from "../gen/nebula/core/v1/entity_pb";
import { isStale } from "./references";

/**
 * Shown where a pinned reference has a newer head version (D101, A§4.4).
 * Re-running is offered once Runs exist (P4) through `onRerun`.
 */
export function StalenessBadge({
  reference,
  headHash,
  onRerun,
}: {
  reference: EntityRef | undefined;
  headHash: string;
  onRerun?: () => void;
}) {
  if (!isStale(reference, headHash)) return null;
  return (
    <span className="badge badge-warn" role="status">
      Newer version available
      {onRerun && (
        <button type="button" className="link" onClick={onRerun}>
          Re-run
        </button>
      )}
    </span>
  );
}
