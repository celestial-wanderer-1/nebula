import { useNavigate } from "react-router";
import { useEntities } from "../api/entities";
import { errorMessage } from "../api/errors";
import { useRerun } from "../api/runs";
import { EntityKind } from "../gen/nebula/core/v1/entity_pb";
import { RerunInputs, type Run } from "../gen/nebula/core/v1/run_pb";
import { ENTITY_LABELS } from "./kinds";
import { staleInputs } from "./runStaleness";

/** Every entity summary of a project, for head versions. */
function useAllSummaries(projectId: string) {
  const lists = [
    useEntities(projectId, EntityKind.GEOMETRY),
    useEntities(projectId, EntityKind.COMPONENT),
    useEntities(projectId, EntityKind.REGION),
    useEntities(projectId, EntityKind.SCENARIO),
    useEntities(projectId, EntityKind.CONDUCTOR_NETWORK),
    useEntities(projectId, EntityKind.WORKFLOW),
  ];
  return lists.flatMap((list) => list.data ?? []);
}

/**
 * Shown on a Run whose pinned inputs have newer head versions (A§4.4,
 * D101): one click re-runs it with the latest versions, reusing the
 * unchanged steps from the cache.
 */
export function RunStaleness({
  run,
  compact = false,
}: {
  run: Run;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const summaries = useAllSummaries(run.projectId);
  const rerun = useRerun(run.projectId);
  const stale = staleInputs(run, summaries);
  if (stale.length === 0) return null;
  const names = stale.map(
    (input) => `${ENTITY_LABELS[input.kind]} “${input.name}”`,
  );
  return (
    <span className="staleness" data-stale={stale.length}>
      <span
        className="badge badge-warn"
        title={`Newer versions: ${names.join(", ")}`}
      >
        Stale
      </span>
      {!compact && (
        <span className="muted small"> Newer: {names.join(", ")}</span>
      )}
      <button
        type="button"
        className="link"
        disabled={rerun.isPending}
        onClick={() =>
          rerun.mutate(
            { runId: run.id, inputs: RerunInputs.LATEST },
            {
              onSuccess: (next) =>
                void navigate(
                  `/p/${encodeURIComponent(run.projectId)}/runs/${encodeURIComponent(next.id)}`,
                ),
            },
          )
        }
      >
        Re-run {run.name || run.id} with latest inputs
      </button>
      {rerun.error && (
        <span className="field-error" role="alert">
          {errorMessage(rerun.error)}
        </span>
      )}
    </span>
  );
}
