import * as Tabs from "@radix-ui/react-tabs";
import { create } from "@bufbuild/protobuf";
import type { Data } from "plotly.js";
import { useEffect, useId, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useComparison } from "../../api/comparisons";
import { useRuns } from "../../api/runs";
import { Quantity } from "../../entities/Quantity";
import type {
  ComparedOutput,
  Comparison,
} from "../../gen/nebula/core/v1/comparison_pb";
import { OutputKind } from "../../gen/nebula/core/v1/output_pb";
import { RegionType } from "../../gen/nebula/core/v1/region_pb";
import {
  ViewerKind,
  ViewParamsSchema,
  type OutputRef,
  type ViewPayload,
} from "../../gen/nebula/core/v1/view_pb";
import { useCameras } from "../../viewers/cameraStore";
import { PlotlyChart } from "../../viewers/plotly/PlotlyChart";
import { VtkPayload } from "../../viewers/VtkPayload";
import { useViewJob } from "../../ws/views";

const NO_PARAMS = create(ViewParamsSchema);

const TABS = ["scalars", "profiles", "difference", "linked"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  scalars: "Scalars",
  profiles: "Profiles",
  difference: "Difference",
  linked: "Linked 3D",
};

const profileable = (o: ComparedOutput) =>
  o.kind === OutputKind.PROFILE ||
  o.kind === OutputKind.FLUX_SURFACES ||
  (o.kind === OutputKind.REGION_FIELD &&
    (o.regionType === RegionType.LINE || o.regionType === RegionType.POINTS));
const differencible = (o: ComparedOutput) =>
  o.kind === OutputKind.REGION_FIELD || o.kind === OutputKind.FLUX_SURFACES;
const linkable = (o: ComparedOutput) =>
  o.kind === OutputKind.REGION_FIELD ||
  o.kind === OutputKind.SURFACE ||
  o.kind === OutputKind.FLUX_SURFACES;

/** The 3D viewer for a field: a contour for planes and flux surfaces. */
const viewerFor = (o: ComparedOutput) =>
  o.kind === OutputKind.FLUX_SURFACES || o.regionType === RegionType.PLANE
    ? ViewerKind.CONTOUR_2D
    : ViewerKind.FIELD_3D;

/**
 * Runs compared on a shared Region (docs/UI.md 6.8, D104): scalar tables
 * flagged against tolerances (D43), overlaid profiles, a difference field
 * and linked 3D views with one camera (A§13.7).
 */
export function ComparisonView() {
  const { projectId = "", comparisonId = "" } = useParams();
  const comparison = useComparison(projectId, comparisonId);
  const runs = useRuns(projectId);
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get("tab") ?? "")
    ? (params.get("tab") as Tab)
    : "scalars";
  const names = useMemo(
    () => new Map(runs.data?.map((run) => [run.id, run.name || run.id]) ?? []),
    [runs.data],
  );

  if (!comparison.data) {
    return comparison.error ? (
      <p className="field-error" role="alert">
        {comparison.error.message}
      </p>
    ) : (
      <p className="muted">Loading comparison…</p>
    );
  }
  const c = comparison.data;
  return (
    <section className="comparison-view">
      <h1>{c.runIds.map((id) => names.get(id) ?? id).join(" vs ")}</h1>
      {c.region?.id && <p className="muted">Shared region: {c.region.id}</p>}
      <Tabs.Root
        value={tab}
        onValueChange={(value) => setParams({ tab: value }, { replace: true })}
      >
        <Tabs.List className="tabs" aria-label="Comparison views">
          {TABS.map((value) => (
            <Tabs.Trigger key={value} value={value} className="tab">
              {TAB_LABELS[value]}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="scalars" className="tab-panel">
          <ScalarTable comparison={c} names={names} />
        </Tabs.Content>
        <Tabs.Content value="profiles" className="tab-panel">
          <OutputChoice outputs={c.outputs.filter(profileable)}>
            {(output) => (
              <Profiles projectId={projectId} output={output} names={names} />
            )}
          </OutputChoice>
        </Tabs.Content>
        <Tabs.Content value="difference" className="tab-panel">
          <OutputChoice outputs={c.outputs.filter(differencible)}>
            {(output) => (
              <Difference
                projectId={projectId}
                comparison={c}
                output={output}
              />
            )}
          </OutputChoice>
        </Tabs.Content>
        <Tabs.Content value="linked" className="tab-panel">
          <OutputChoice outputs={c.outputs.filter(linkable)}>
            {(output) => (
              <Linked
                projectId={projectId}
                group={`comparison-${c.id}`}
                output={output}
                names={names}
              />
            )}
          </OutputChoice>
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}

function ScalarTable({
  comparison,
  names,
}: {
  comparison: Comparison;
  names: ReadonlyMap<string, string>;
}) {
  if (comparison.scalars.length === 0) {
    return <p className="muted">The runs share no scalar outputs.</p>;
  }
  const flagged = comparison.scalars.filter((row) => row.outOfTolerance).length;
  return (
    <>
      <p role="status" aria-label="Comparison summary">
        {flagged
          ? `${flagged} ${flagged === 1 ? "quantity differs" : "quantities differ"} beyond tolerance.`
          : "Every quantity agrees within tolerance."}
      </p>
      <table
        className="table scalar-comparison"
        aria-label="Scalars across runs"
      >
        <thead>
          <tr>
            <th scope="col">Quantity</th>
            {comparison.runIds.map((id) => (
              <th key={id} scope="col">
                {names.get(id) ?? id}
              </th>
            ))}
            <th scope="col">Tolerance</th>
            <th scope="col">Agreement</th>
          </tr>
        </thead>
        <tbody>
          {comparison.scalars.map((row) => (
            <tr
              key={`${row.output}/${row.quantity}`}
              data-quantity={row.quantity}
              className={row.outOfTolerance ? "out-of-tolerance" : undefined}
            >
              <th scope="row">
                {row.label} <span className="muted small">{row.output}</span>
              </th>
              {row.cells.map((cell) => (
                <td key={cell.runId}>
                  {cell.value === undefined ? (
                    "—"
                  ) : (
                    <Quantity value={cell.value} unit={row.unit} />
                  )}
                </td>
              ))}
              <td>
                {[
                  row.tolerance?.abs !== undefined &&
                    `±${row.tolerance.abs} ${row.unit}`,
                  row.tolerance?.rel !== undefined &&
                    `±${Number((row.tolerance.rel * 100).toPrecision(2))}%`,
                ]
                  .filter(Boolean)
                  .join(" or ") || "exact"}
              </td>
              <td>
                {row.outOfTolerance ? (
                  <span className="badge badge-error">
                    Out of tolerance ({(row.maxRelDiff * 100).toPrecision(2)}%)
                  </span>
                ) : (
                  <span className="ok">Within tolerance</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** A select of the compared outputs a view applies to, then the view. */
function OutputChoice({
  outputs,
  children,
}: {
  outputs: readonly ComparedOutput[];
  children: (output: ComparedOutput) => React.ReactNode;
}) {
  const id = useId();
  const [key, setKey] = useState(outputs[0]?.key ?? "");
  const output = outputs.find((o) => o.key === key) ?? outputs[0];
  if (!output) return <p className="muted">No shared output fits this view.</p>;
  return (
    <div className="stack">
      <div className="field">
        <label htmlFor={id}>Output</label>
        <select
          id={id}
          value={output.key}
          onChange={(event) => setKey(event.target.value)}
        >
          {outputs.map((o) => (
            <option key={o.key} value={o.key}>
              {o.key} ({o.subContract})
            </option>
          ))}
        </select>
      </div>
      {children(output)}
    </div>
  );
}

/** Fetches one Run's profile payload and hands it up. */
function ProfileJob({
  projectId,
  output,
  onPayload,
}: {
  projectId: string;
  output: OutputRef;
  onPayload: (runId: string, payload: ViewPayload | undefined) => void;
}) {
  const job = useViewJob(projectId, output, ViewerKind.PROFILE_1D, NO_PARAMS);
  useEffect(
    () => onPayload(output.runId, job.payload),
    [job.payload, output.runId, onPayload],
  );
  return null;
}

/** Profiles of every Run overlaid in one chart (A§13.7). */
function Profiles({
  projectId,
  output,
  names,
}: {
  projectId: string;
  output: ComparedOutput;
  names: ReadonlyMap<string, string>;
}) {
  const [payloads, setPayloads] = useState<
    Record<string, ViewPayload | undefined>
  >({});
  const onPayload = useMemo(
    () => (runId: string, payload: ViewPayload | undefined) =>
      setPayloads((held) =>
        held[runId] === payload ? held : { ...held, [runId]: payload },
      ),
    [],
  );
  const traces: Data[] = output.refs.flatMap((ref) => {
    const payload = payloads[ref.runId];
    if (payload?.body.case !== "plotly") return [];
    const data = (payload.body.value.figure?.data ?? []) as unknown as {
      name?: string;
    }[];
    return data.map((trace) => ({
      ...trace,
      name: `${trace.name ?? output.key} · ${names.get(ref.runId) ?? ref.runId}`,
    })) as Data[];
  });
  const loaded = output.refs.every((ref) => payloads[ref.runId]);
  return (
    <>
      {output.refs.map((ref) => (
        <ProfileJob
          key={ref.runId}
          projectId={projectId}
          output={ref}
          onPayload={onPayload}
        />
      ))}
      {!loaded && (
        <p className="muted" role="status">
          Computing profiles…
        </p>
      )}
      {traces.length > 0 && (
        <PlotlyChart
          label={`Profiles of ${output.key} across runs`}
          data={traces}
          height={360}
        />
      )}
    </>
  );
}

/** The first Run minus the second, resampled on the shared Region (D104). */
function Difference({
  projectId,
  comparison,
  output,
}: {
  projectId: string;
  comparison: Comparison;
  output: ComparedOutput;
}) {
  const [first, second] = output.refs;
  const job = useViewJob(projectId, first, viewerFor(output), NO_PARAMS, {
    reference: second,
    region: comparison.region,
  });
  return (
    <>
      <p className="view-status" role="status" aria-label="Difference status">
        {job.pending
          ? "Computing difference on the GPU…"
          : job.error
            ? ""
            : "Up to date"}
      </p>
      {job.error && (
        <p className="field-error" role="alert">
          {job.error}
        </p>
      )}
      {job.payload && <VtkPayload payload={job.payload} />}
    </>
  );
}

function LinkedView({
  projectId,
  group,
  output,
  viewer,
  label,
}: {
  projectId: string;
  group: string;
  output: OutputRef;
  viewer: ViewerKind;
  label: string;
}) {
  const job = useViewJob(projectId, output, viewer, NO_PARAMS);
  const camera = useCameras((state) => state.poses[group]);
  const setPose = useCameras((state) => state.setPose);
  const onCamera = useMemo(
    () => (pose: Parameters<typeof setPose>[1]) => setPose(group, pose),
    [group, setPose],
  );
  return (
    <figure className="linked-view">
      <figcaption>{label}</figcaption>
      {job.payload ? (
        <VtkPayload payload={job.payload} camera={camera} onCamera={onCamera} />
      ) : (
        <p className="muted">Loading…</p>
      )}
    </figure>
  );
}

/** Each Run's field side by side, sharing one camera (A§13.7). */
function Linked({
  projectId,
  group,
  output,
  names,
}: {
  projectId: string;
  group: string;
  output: ComparedOutput;
  names: ReadonlyMap<string, string>;
}) {
  return (
    <div className="linked-views" data-camera-group={group}>
      {output.refs.slice(0, 2).map((ref) => (
        <LinkedView
          key={ref.runId}
          projectId={projectId}
          group={group}
          output={ref}
          viewer={viewerFor(output)}
          label={names.get(ref.runId) ?? ref.runId}
        />
      ))}
    </div>
  );
}
