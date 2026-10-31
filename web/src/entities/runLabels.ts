import { RunState } from "../gen/nebula/core/v1/run_pb";

export const RUN_STATE_LABELS: Readonly<Record<RunState, string>> = {
  [RunState.UNSPECIFIED]: "Unknown",
  [RunState.QUEUED]: "Queued",
  [RunState.PREPARING]: "Preparing",
  [RunState.RUNNING]: "Running",
  [RunState.PAUSED]: "Paused",
  [RunState.COMPLETED]: "Completed",
  [RunState.FAILED]: "Failed",
  [RunState.CANCELLED]: "Cancelled",
  [RunState.DISCARDED]: "Discarded",
};
