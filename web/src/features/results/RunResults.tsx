import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useEntityVersion } from "../../api/entities";
import { NotFoundError } from "../../api/errors";
import { unpackAs } from "../../entities/content";
import { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { WorkflowSchema } from "../../gen/nebula/core/v1/workflow_pb";
import { usePlugins } from "../../api/plugins";
import { useRun, useRunOutputs } from "../../api/runs";
import { RunStateBadge } from "../../entities/RunStateBadge";
import { OutputKind } from "../../gen/nebula/core/v1/output_pb";
import { descriptorsFor } from "../../viewers/catalogue";
import { ScalarsTable } from "../../viewers/ScalarsTable";
import { ViewerHost } from "../../viewers/ViewerHost";
import { useRunChannel } from "../../ws/channels";
import { extensionIndex, stepOf } from "../../workflow/ports";
import { OutputList } from "./OutputList";
import { outputKey } from "./outputs";

/**
 * A Run's results (docs/UI.md 6.7): its outputs, and the selected one in
 * the viewers of the catalogue. `?output=<node>/<name>` selects it.
 */
export function RunResults() {
  const { projectId = "", runId = "" } = useParams();
  const [params] = useSearchParams();
  useRunChannel(projectId, runId);
  const run = useRun(projectId, runId);
  const outputs = useRunOutputs(projectId, runId);
  const plugins = usePlugins();
  const extensions = useMemo(
    () => extensionIndex(plugins.data ?? []),
    [plugins.data],
  );
  const labels = useMemo(
    () => new Map(run.data?.steps.map((s) => [s.nodeId, s.label]) ?? []),
    [run.data?.steps],
  );
  const version = useEntityVersion(
    projectId,
    EntityKind.WORKFLOW,
    run.data?.workflowId,
    run.data?.workflowVersionHash,
  );
  const workflow = useMemo(
    () =>
      version.data?.content
        ? unpackAs(WorkflowSchema, version.data.content)
        : undefined,
    [version.data?.content],
  );
  const selectedKey = params.get("output") ?? "";
  const selected = outputs.data?.find((o) => outputKey(o) === selectedKey);

  if (run.error instanceof NotFoundError) {
    return (
      <section className="placeholder">
        <h1>Run not found</h1>
      </section>
    );
  }
  // The extension that produced the selected output, for its view
  // descriptors (D87).
  const producer = workflow?.nodes.find((n) => n.id === selected?.nodeId);
  const extension = extensions.get(
    producer ? (stepOf(producer)?.extensionId ?? "") : "",
  );
  const descriptors = selected ? descriptorsFor(selected, extension) : [];

  return (
    <section className="results-page">
      <div className="page-header">
        <h1>Results of {run.data?.name || runId}</h1>
        {run.data && <RunStateBadge run={run.data} />}
      </div>
      <p>
        <Link
          to={`/p/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`}
        >
          Run details
        </Link>
      </p>
      <div className="results-layout">
        <OutputList
          outputs={outputs.data ?? []}
          labels={labels}
          selected={selectedKey}
          linkTo={(o) => `?output=${encodeURIComponent(outputKey(o))}`}
        />
        <div className="results-view">
          {!selected && <p className="muted">Choose an output to view.</p>}
          {selected?.kind === OutputKind.SCALARS && (
            <ScalarsTable
              scalars={selected.scalars}
              label={`Scalars of ${selected.nodeId}`}
            />
          )}
          {selected && selected.kind !== OutputKind.SCALARS && (
            <ViewerHost
              key={outputKey(selected)}
              projectId={projectId}
              output={selected}
              descriptors={descriptors}
            />
          )}
        </div>
      </div>
    </section>
  );
}
