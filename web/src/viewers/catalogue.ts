import { OutputKind, type RunOutput } from "../gen/nebula/core/v1/output_pb";
import type { Extension } from "../gen/nebula/core/v1/plugin_pb";
import { RegionType } from "../gen/nebula/core/v1/region_pb";
import { ViewerKind, type ViewDescriptor } from "../gen/nebula/core/v1/view_pb";

// The viewer catalogue (A§13.6): which viewers fit an output, by output kind
// refined by region type (D87, D89); plugin view descriptors come first.

export const VIEWER_LABELS: Readonly<Record<ViewerKind, string>> = {
  [ViewerKind.UNSPECIFIED]: "View",
  [ViewerKind.PROFILE_1D]: "1D profile",
  [ViewerKind.CONTOUR_2D]: "2D contour",
  [ViewerKind.FIELD_3D]: "3D field",
  [ViewerKind.SPECTRUM]: "Spectrum",
  [ViewerKind.POINCARE]: "Poincaré",
  [ViewerKind.MODE_STRUCTURE]: "Mode structure",
  [ViewerKind.TIME_TRACE]: "Time trace",
};

/** Viewers drawn with vtk.js; the rest are Plotly (A§13.6). */
export const VTK_VIEWERS: ReadonlySet<ViewerKind> = new Set([
  ViewerKind.CONTOUR_2D,
  ViewerKind.FIELD_3D,
  ViewerKind.POINCARE,
  ViewerKind.MODE_STRUCTURE,
]);

function byRegion(type: RegionType): ViewerKind[] {
  switch (type) {
    case RegionType.POINTS:
    case RegionType.LINE:
      return [ViewerKind.PROFILE_1D];
    case RegionType.PLANE:
    case RegionType.STEP_OUTPUT_SURFACE:
      return [ViewerKind.CONTOUR_2D];
    default:
      return [ViewerKind.FIELD_3D];
  }
}

function byKind(output: RunOutput): ViewerKind[] {
  switch (output.kind) {
    case OutputKind.PROFILE:
      return [ViewerKind.PROFILE_1D];
    case OutputKind.REGION_FIELD:
      return byRegion(output.regionType);
    case OutputKind.FLUX_SURFACES:
      return [ViewerKind.CONTOUR_2D, ViewerKind.PROFILE_1D];
    case OutputKind.SPECTRUM:
      return [ViewerKind.SPECTRUM];
    case OutputKind.EIGENMODE:
      return [ViewerKind.MODE_STRUCTURE, ViewerKind.SPECTRUM];
    case OutputKind.SURFACE:
      return [ViewerKind.FIELD_3D];
    case OutputKind.FIELD_LINES:
      return [ViewerKind.POINCARE, ViewerKind.FIELD_3D];
    default:
      // Scalars show as a table; operators have no view.
      return [];
  }
}

/** The view descriptors of the extension that produced an output. */
export function descriptorsFor(
  output: RunOutput,
  extension: Extension | undefined,
): ViewDescriptor[] {
  return extension?.views.filter((view) => view.output === output.name) ?? [];
}

/**
 * Viewers for an output, best first: the plugin's descriptors, then the
 * defaults of its kind and region type; time series add a time trace
 * (D146).
 */
export function eligibleViewers(
  output: RunOutput,
  descriptors: readonly ViewDescriptor[] = [],
): ViewerKind[] {
  const viewers = [
    ...descriptors.map((d) => d.viewer),
    ...byKind(output),
    ...(output.timeSeries ? [ViewerKind.TIME_TRACE] : []),
  ];
  return [...new Set(viewers)].filter((v) => v !== ViewerKind.UNSPECIFIED);
}
