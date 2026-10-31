import type { MessageInitShape } from "@bufbuild/protobuf";
import { EntityKind } from "../gen/nebula/core/v1/entity_pb";
import {
  ExtensionKind,
  type ExtensionSchema,
  type PortDeclSchema,
} from "../gen/nebula/core/v1/plugin_pb";

// Workflow extensions of the fixture plugins: typed ports, traits and GPU
// hints (A§7.2, D55, D64, D102, D116). Sub-contract names are illustrative.

type ExtensionInit = MessageInitShape<typeof ExtensionSchema>;
type PortInit = MessageInitShape<typeof PortDeclSchema>;

/** Sub-contracts the fixtures use. */
export const SUB = {
  fieldSampled: "MagneticField.Sampled",
  fieldOperator: "MagneticField.Operator",
  axisym: "Equilibrium.Axisym2D",
  flux: "Equilibrium.FluxCoordinates",
  boundary: "Surface.Boundary",
  spectrum: "Stability.Spectrum",
  modes: "Stability.Modes",
  profiles: "Transport.Profiles",
  scalar: "Objective.Scalar",
  derived: "View.Derived",
  ripple: "Field.Ripple",
} as const;

const data = (name: string, subContract: string, timeBase = ""): PortInit => ({
  name,
  type: {
    type: { case: "subContract", value: subContract },
    timeSeries: Boolean(timeBase),
    timeBase,
  },
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
      data("field", SUB.fieldSampled),
      data("operator", SUB.fieldOperator),
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
    outputs: [data("equilibrium", SUB.axisym), data("lcfs", SUB.boundary)],
    requiredTraits: ["axisymmetric", "closed_field_lines"],
    gpu: { defaultGpus: 1, rankCounts: [1, 2, 4] },
  },
  {
    id: "nebula.adapter.flux_coordinates",
    kind: ExtensionKind.ADAPTER,
    displayName: "Flux coordinates",
    calculationType: "adapter",
    inputs: [data("equilibrium", SUB.axisym)],
    outputs: [data("equilibrium", SUB.flux)],
    gpu: { defaultGpus: 1, rankCounts: [1] },
  },
  {
    id: "nebula.stability.local",
    kind: ExtensionKind.SOLVER,
    displayName: "Local stability",
    calculationType: "stability",
    inputs: [data("equilibrium", SUB.axisym)],
    outputs: [data("growth_rates", SUB.spectrum)],
    requiredTraits: ["axisymmetric"],
    gpu: { defaultGpus: 1, rankCounts: [1] },
  },
  {
    id: "nebula.stability.global",
    kind: ExtensionKind.SOLVER,
    displayName: "Global stability",
    calculationType: "stability",
    inputs: [data("equilibrium", SUB.flux)],
    outputs: [data("modes", SUB.modes), data("growth_rates", SUB.spectrum)],
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
      data("profiles", SUB.profiles, "scenario"),
      data("equilibria", SUB.axisym, "scenario"),
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
    outputs: [data("value", SUB.scalar)],
    gpu: { defaultGpus: 1, rankCounts: [1] },
  },
  // Core PostOps (A§9.5).
  ...(
    [
      ["slice", "Slice"],
      ["field_lines", "Field lines"],
      ["poincare", "Poincaré"],
    ] as const
  ).map(([name, displayName]): ExtensionInit => ({
    id: `nebula.postop.${name}`,
    kind: ExtensionKind.POST_OP,
    displayName,
    calculationType: "post-processing",
    inputs: [data("field", SUB.fieldSampled)],
    outputs: [data(name, SUB.derived)],
    gpu: { defaultGpus: 1, rankCounts: [1] },
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
    outputs: [data("equilibrium", SUB.axisym)],
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
    outputs: [data("equilibrium", SUB.flux)],
    gpu: { defaultGpus: 1, rankCounts: [1] },
  },
  {
    id: "acme.demo.ripple",
    kind: ExtensionKind.POST_OP,
    displayName: "Ripple",
    calculationType: "post-processing",
    configMessage: "acme.demo.v1.DemoPostOpConfig",
    inputs: [data("field", SUB.fieldSampled)],
    outputs: [data("ripple", SUB.ripple)],
    gpu: { defaultGpus: 1, rankCounts: [1] },
  },
];
