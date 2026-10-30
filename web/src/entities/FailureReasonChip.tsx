import { FailureReason } from "../gen/nebula/core/v1/run_pb";

const REASONS: Partial<Record<FailureReason, string>> = {
  [FailureReason.OOM]: "oom",
  [FailureReason.NAN]: "nan",
  [FailureReason.DIVERGED]: "diverged",
  [FailureReason.PLUGIN_ERROR]: "plugin_error",
  [FailureReason.GEOMETRY_FAILED]: "geometry_failed",
  [FailureReason.CRASHED]: "crashed",
  [FailureReason.SUPERVISOR_LOST]: "supervisor_lost",
};

/** Typed failure reason of A§3.7. */
export function FailureReasonChip({ reason }: { reason: FailureReason }) {
  const text = REASONS[reason];
  if (!text) return null;
  return <span className="badge badge-error">{text}</span>;
}
