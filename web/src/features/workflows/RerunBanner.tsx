import type { Any } from "@bufbuild/protobuf/wkt";
import { useState } from "react";
import { Link } from "react-router";
import { useEntityVersion } from "../../api/entities";
import { useRun } from "../../api/runs";
import { shortHash } from "../../entities/references";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";

/**
 * "Re-run with edited workflow" (D141): loads the failed Run's workflow
 * version into the draft, so it can be edited and submitted as a new Run
 * that records which Run it re-runs.
 */
export function RerunBanner({
  projectId,
  runId,
  onLoad,
  onDone,
}: {
  projectId: string;
  runId: string;
  onLoad: (content: Any) => void;
  onDone: () => void;
}) {
  const run = useRun(projectId, runId);
  const version = useEntityVersion(
    projectId,
    EntityKind.WORKFLOW,
    run.data?.workflowId,
    run.data?.workflowVersionHash,
  );
  const [loaded, setLoaded] = useState(false);
  const content = version.data?.content;
  return (
    <div className="banner" role="region" aria-label="Re-run">
      <p>
        Re-running{" "}
        <Link
          to={`/p/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`}
        >
          {run.data?.name || runId}
        </Link>{" "}
        with an edited workflow.{" "}
        {loaded
          ? "Its workflow version is in the draft: edit it, then Run."
          : run.data &&
            `It ran workflow version ${shortHash(run.data.workflowVersionHash)}.`}
      </p>
      <div className="actions">
        {!loaded && (
          <button
            type="button"
            className="primary"
            disabled={!content}
            onClick={() => {
              if (!content) return;
              onLoad(content);
              setLoaded(true);
            }}
          >
            Load its workflow into the draft
          </button>
        )}
        <button type="button" onClick={onDone}>
          Not a re-run
        </button>
      </div>
    </div>
  );
}
