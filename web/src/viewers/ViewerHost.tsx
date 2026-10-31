import { create } from "@bufbuild/protobuf";
import { useMemo, useState } from "react";
import type { RunOutput } from "../gen/nebula/core/v1/output_pb";
import {
  OutputRefSchema,
  ViewParamsSchema,
  type ViewDescriptor,
  type ViewerKind,
  type ViewParams,
} from "../gen/nebula/core/v1/view_pb";
import { useViewJob } from "../ws/views";
import { eligibleViewers, VIEWER_LABELS, VTK_VIEWERS } from "./catalogue";
import { PlotlyPayload } from "./PlotlyPayload";
import { TimeSlider } from "./TimeSlider";
import { ViewParamsForm } from "./ViewParamsForm";
import { VtkPayload } from "./VtkPayload";
import type { CameraPose } from "./vtk/VtkCanvas";

/**
 * Views of one output (docs/UI.md 6.7): the viewers its kind and region
 * allow, best first; their parameters; and the payload from /ws/views.
 * While a request is out, the previous payload stays, marked pending.
 */
export function ViewerHost({
  projectId,
  output,
  descriptors = [],
  camera,
  onCamera,
}: {
  projectId: string;
  output: RunOutput;
  descriptors?: readonly ViewDescriptor[];
  camera?: CameraPose;
  onCamera?: (pose: CameraPose) => void;
}) {
  const viewers = useMemo(
    () => eligibleViewers(output, descriptors),
    [output, descriptors],
  );
  const [chosen, setViewer] = useState<ViewerKind>();
  const viewer = chosen && viewers.includes(chosen) ? chosen : viewers[0];
  const [paramsByViewer, setParams] = useState<
    Partial<Record<ViewerKind, ViewParams>>
  >({});
  const descriptor = descriptors.find((d) => d.viewer === viewer);
  const params =
    (viewer !== undefined && paramsByViewer[viewer]) ||
    create(ViewParamsSchema, descriptor?.defaults ?? {});
  const [timeIndex, setTimeIndex] = useState(0);
  const request = useMemo(
    () =>
      output.time
        ? {
            ...params,
            timeIndex: Math.min(timeIndex, output.time.times.length - 1),
          }
        : params,
    [params, timeIndex, output.time],
  );
  const ref = useMemo(
    () =>
      create(OutputRefSchema, {
        runId: output.runId,
        nodeId: output.nodeId,
        outputName: output.name,
        contentHash: output.contentHash,
      }),
    [output],
  );
  const job = useViewJob(
    projectId,
    viewer !== undefined ? ref : undefined,
    viewer ?? 0,
    request,
    { postOp: descriptor?.postOp },
  );

  if (viewer === undefined) {
    return <p className="muted">This output has no viewer.</p>;
  }
  const payload = job.payload?.viewer === viewer ? job.payload : undefined;
  return (
    <section className="viewer-host" aria-label="Viewer">
      <div className="viewer-tabs" role="toolbar" aria-label="Viewers">
        {viewers.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={kind === viewer}
            onClick={() => setViewer(kind)}
          >
            {descriptors.find((d) => d.viewer === kind)?.title ||
              VIEWER_LABELS[kind]}
          </button>
        ))}
      </div>
      <ViewParamsForm
        key={viewer}
        viewer={viewer}
        params={params}
        onChange={(next) => setParams((held) => ({ ...held, [viewer]: next }))}
      />
      {output.time && (
        <TimeSlider
          time={output.time}
          index={timeIndex}
          onChange={setTimeIndex}
        />
      )}
      <p className="view-status" role="status" aria-label="View status">
        {job.pending
          ? payload
            ? "Updating…"
            : "Computing view…"
          : job.error
            ? ""
            : payload
              ? job.cached
                ? "From the view cache"
                : "Up to date"
              : ""}
      </p>
      {job.error && (
        <p className="field-error" role="alert">
          {job.error}
        </p>
      )}
      <div className={job.pending && payload ? "view-body stale" : "view-body"}>
        {payload &&
          (VTK_VIEWERS.has(viewer) ? (
            <VtkPayload payload={payload} camera={camera} onCamera={onCamera} />
          ) : (
            <PlotlyPayload payload={payload} />
          ))}
      </div>
    </section>
  );
}
