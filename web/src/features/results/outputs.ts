import { OutputKind, type RunOutput } from "../../gen/nebula/core/v1/output_pb";

export const OUTPUT_KINDS: Readonly<Record<OutputKind, string>> = {
  [OutputKind.UNSPECIFIED]: "—",
  [OutputKind.SCALARS]: "scalars",
  [OutputKind.PROFILE]: "profile",
  [OutputKind.REGION_FIELD]: "field on region",
  [OutputKind.FLUX_SURFACES]: "flux surfaces",
  [OutputKind.SPECTRUM]: "spectrum",
  [OutputKind.EIGENMODE]: "eigenmodes",
  [OutputKind.FIELD_OPERATOR]: "operator",
  [OutputKind.SURFACE]: "surface",
  [OutputKind.FIELD_LINES]: "field lines",
};

export const outputKey = (output: RunOutput) =>
  `${output.nodeId}/${output.name}`;
