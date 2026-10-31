import type { MessageInitShape } from "@bufbuild/protobuf";
import { EntityKind } from "../gen/nebula/core/v1/entity_pb";
import { OutputKind } from "../gen/nebula/core/v1/output_pb";
import {
  ExtensionKind,
  type ExtensionSchema,
  type PortDeclSchema,
} from "../gen/nebula/core/v1/plugin_pb";
import { ViewerKind } from "../gen/nebula/core/v1/view_pb";

// Workflow extensions of the fixture plugins: typed ports, output kinds,
// traits, GPU hints and view descriptors (A§7.2, D55, D64, D87, D102,
// D116). Sub-contract names are illustrative.

type ExtensionInit = MessageInitShape<typeof ExtensionSchema>;
type PortInit = MessageInitShape<typeof PortDeclSchema>;

/** Sub-contracts the fixtures use. */
export const SUB = {
  fieldSampled: "MagneticField.Sampled",
  fieldOperator: "MagneticField.Operator",
  axisym: "Equilibrium.Axisym2D",
  flux: "Equilibrium.FluxCoordinates",
  boundary: "Surface.Boundary",
  scalars: "Equilibrium.Scalars",
  spectrum: "Stability.Spectrum",
  modes: "Stability.Modes",
  profiles: "Transport.Profiles",
  scalar: "Objective.Scalar",
  derived: "View.Derived",
  ripple: "Field.Ripple",
  demoScalars: "Demo.Scalars",
} as const;

const data = (
  name: string,
  subContract: string,
  outputKind = OutputKind.UNSPECIFIED,
  timeBase = "",
): PortInit => ({
  name,
  type: {
    type: { case: "subContract", value: subContract },
    timeSeries: Boolean(timeBase),
    timeBase,
  },
  outputKind,
});

const entity = (
  name: string,
  kind: EntityKind,
  optional = false,
): PortInit => ({
  name,
  type: { type: { case: "entity", value: kind } },
  optional,
});

/** First-party workflow extensions, declared in the core manifest (D111). */
export const coreStepExtensions: ExtensionInit[] = [
  {
    id: "nebula.field.biot_savart",
    kind: ExtensionKind.SOLVER,
    displayName: "Biot–Savart field",
    calculationType: "field",
    subContracts: [SUB.fieldSampled, SUB.fieldOperator],
    inputs: [
      entity("geometry", EntityKind.GEOMETRY),
      entity("scenario", EntityKind.SCENARIO),
      entity("region", EntityKind.REGION, true),
    ],
    outputs: [
      data("field", SUB.fieldSampled, OutputKind.REGION_FIELD),
      data("operator", SUB.fieldOperator, OutputKind.FIELD_OPERATOR),
    ],
    gpu: { defaultGpus: 1 },
  },
  {
    id: "nebula.equilibrium.t1",
    kind: ExtensionKind.SOLVER,
    displayName: "T1 equilibrium",
    calculationType: "equilibrium",
    subContracts: [SUB.axisym],
    inputs: [
      data("field", SUB.fieldOperator),
      entity("scenario", EntityKind.SCENARIO),
    ],
    outputs: [
      data("equilibrium", SUB.axisym, OutputKind.FLUX_SURFACES),
      data("lcfs", SUB.boundary, OutputKind.SURFACE),
      data("scalars", SUB.scalars, OutputKind.SCALARS),
    ],
    requiredTraits: ["axisymmetric", "closed_field_lines"],
    gpu: { defaultGpus: 1, rankCounts: [1, 2, 4] },
  },
  {
    id: "nebula.adapter.flux_coordinates",
    kind: ExtensionKind.ADAPTER,
    displayName: "Flux coordinates",
    calculationType: "adapter",
    inputs: [data("equilibrium", SUB.axisym)],
    outputs: [data("equilibrium", SUB.flux, OutputKind.FLUX_SURFACES)],
    gpu: { defaultGpus: 1, rankCounts: [1] },
  },
  {
    id: "nebula.stability.local",
    kind: ExtensionKind.SOLVER,
    displayName: "Local stability",
    calculationType: "stability",
    inputs: [data("equilibrium", SUB.axisym)],
    outputs: [data("growth_rates", SUB.spectrum, OutputKind.SPECTRUM)],
    requiredTraits: ["axisymmetric"],
    gpu: { defaultGpus: 1, rankCounts: [1] },
  },
  {
    id: "nebula.stability.global",
    kind: ExtensionKind.SOLVER,
    displayName: "Global stability",
    calculationType: "stability",
    inputs: [data("equilibrium", SUB.flux)],
    outputs: [
      data("modes", SUB.modes, OutputKind.EIGENMODE),
      data("growth_rates", SUB.spectrum, OutputKind.SPECTRUM),
    ],
    gpu: { defaultGpus: 2, rankCounts: [1, 2, 4] },
  },
  {
    id: "nebula.evolution.transport",
    kind: ExtensionKind.SOLVER,
    displayName: "Transport evolution",
    calculationType: "evolution",
    inputs: [
      data("equilibrium", SUB.axisym),
      entity("scenario", EntityKind.SCENARIO),
    ],
    outputs: [
      data("profiles", SUB.profiles, OutputKind.PROFILE, "scenario"),
      data("equilibria", SUB.axisym, OutputKind.FLUX_SURFACES, "scenario"),
    ],
    requiredTraits: ["axisymmetric", "closed_field_lines"],
    gpu: { defaultGpus: 1, rankCounts: [1] },
  },
  {
    id: "nebula.objective.q95",
    kind: ExtensionKind.OBJECTIVE,
    displayName: "q95",
    calculationType: "objective",
    inputs: [data("equilibrium", SUB.axisym)],
    outputs: [data("value", SUB.scalar, OutputKind.SCALARS)],
    gpu: { defaultGpus: 1, rankCounts: [1] },
  },
  // Core PostOps (A§9.5).
  ...(
    [
      ["slice", "Slice", OutputKind.REGION_FIELD],
      ["field_lines", "Field lines", OutputKind.FIELD_LINES],
      ["poincare", "Poincaré", OutputKind.FIELD_LINES],
    ] as const
  ).map(([name, displayName, kind]): ExtensionInit => ({
    id: `nebula.postop.${name}`,
    kind: ExtensionKind.POST_OP,
    displayName,
    calculationType: "post-processing",
    inputs: [data("field", SUB.fieldSampled)],
    outputs: [data(name, SUB.derived, kind)],
    gpu: { defaultGpus: 1, rankCounts: [1] },
    // A Poincaré output opens in the Poincaré viewer first (D87).
    views:
      name === "poincare"
        ? [
            {
              output: name,
              viewer: ViewerKind.POINCARE,
              title: "Poincaré section",
            },
          ]
        : [],
  })),
];

/** Topological traits each concept kit provides (D64). */
export const conceptTraits: Readonly<Record<string, readonly string[]>> = {
  "nebula.concept.tokamak": ["closed_field_lines", "nonzero_toroidal_field"],
  "nebula.concept.simple_mirror": ["open_lines"],
  "nebula.concept.stellarator": [
    "closed_field_lines",
    "nonzero_toroidal_field",
  ],
};

/** Workflow extensions of the fake plugin acme.demo. */
export const acmeStepExtensions: ExtensionInit[] = [
  {
    id: "acme.demo.solver",
    kind: ExtensionKind.SOLVER,
    displayName: "Demo solver",
    calculationType: "equilibrium",
    configMessage: "acme.demo.v1.DemoSolverConfig",
    subContracts: [SUB.axisym],
    inputs: [data("field", SUB.fieldOperator)],
    outputs: [
      data("equilibrium", SUB.axisym, OutputKind.FLUX_SURFACES),
      data("scalars", SUB.demoScalars, OutputKind.SCALARS),
    ],
    requiredTraits: ["closed_field_lines"],
    gpu: { defaultGpus: 1, rankCounts: [1, 2, 4, 8] },
  },
  {
    id: "acme.demo.upsample",
    kind: ExtensionKind.ADAPTER,
    displayName: "Demo upsampler",
    calculationType: "adapter",
    configMessage: "acme.demo.v1.DemoAdapterConfig",
    inputs: [data("equilibrium", SUB.axisym)],
    outputs: [data("equilibrium", SUB.flux, OutputKind.FLUX_SURFACES)],
    gpu: { defaultGpus: 1, rankCounts: [1] },
  },
  {
    id: "acme.demo.ripple",
    kind: ExtensionKind.POST_OP,
    displayName: "Ripple",
    calculationType: "post-processing",
    configMessage: "acme.demo.v1.DemoPostOpConfig",
    inputs: [data("field", SUB.fieldSampled)],
    outputs: [data("ripple", SUB.ripple, OutputKind.PROFILE)],
    gpu: { defaultGpus: 1, rankCounts: [1] },
    // The plugin picks the 1D viewer for its output, with a title (D87).
    views: [
      {
        output: "ripple",
        viewer: ViewerKind.PROFILE_1D,
        title: "Toroidal field ripple",
        defaults: { maxPoints: 360 },
      },
    ],
  },
];
