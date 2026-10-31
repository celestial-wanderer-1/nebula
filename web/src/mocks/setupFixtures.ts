import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { anyPack, type Any } from "@bufbuild/protobuf/wkt";
import { ConductorNetworkSchema } from "../gen/nebula/core/v1/conductor_network_pb";
import {
  InputDatasetSchema,
  type InputDataset,
} from "../gen/nebula/core/v1/dataset_pb";
import { EntityKind } from "../gen/nebula/core/v1/entity_pb";
import {
  EquilibriumScalarsSchema,
  OutputKind,
  RunOutputSchema,
  type RunOutput,
} from "../gen/nebula/core/v1/output_pb";
import { RegionSchema, RegionType } from "../gen/nebula/core/v1/region_pb";
import {
  DeterminismMode,
  ProvenanceTag,
  RunSchema,
  RunState,
  type Run,
} from "../gen/nebula/core/v1/run_pb";
import {
  PlasmaTargetsSchema,
  ScenarioSchema,
} from "../gen/nebula/core/v1/scenario_pb";
import {
  WorkflowSchema,
  WorkflowTemplateSchema,
  type WorkflowTemplate,
} from "../gen/nebula/core/v1/workflow_pb";
import { SUB } from "./extensions";
import {
  at,
  entity,
  entityRef,
  pack,
  version,
  type EntityRecord,
} from "./records";

// Setup fixtures (docs/UI.md 6.4, 6.5): regions, scenarios, conductor
// networks, workflows and workflow templates, plus the Runs and committed
// outputs that stored-output nodes pick from.

type WorkflowInit = MessageInitShape<typeof WorkflowSchema>;
type NodeInit = NonNullable<WorkflowInit["nodes"]>[number];
type RefState = Parameters<typeof entityRef>[2];

const step = (
  id: string,
  kind: "solver" | "adapter" | "postOp" | "objective",
  extensionId: string,
  label: string,
  x: number,
  y: number,
  bindings: {
    port: string;
    kind: EntityKind;
    id: string;
    state?: RefState;
  }[] = [],
): NodeInit => ({
  id,
  label,
  layout: { x, y },
  kind: {
    case: kind,
    value: {
      extensionId,
      bindings: bindings.map((b) => ({
        port: b.port,
        ref: entityRef(b.kind, b.id, b.state),
      })),
    },
  },
});

const edge = (
  id: string,
  from: string,
  fromPort: string,
  to: string,
  toPort: string,
) => ({
  id,
  from: { nodeId: from, port: fromPort },
  to: { nodeId: to, port: toPort },
});

/** Entities a field step is bound to; unbound in templates. */
interface FieldInputs {
  geometry?: { id: string; state?: RefState };
  scenario?: { id: string; state?: RefState };
  region?: { id: string; state?: RefState };
}

function fieldBindings(inputs: FieldInputs) {
  return [
    inputs.geometry && {
      port: "geometry",
      kind: EntityKind.GEOMETRY,
      ...inputs.geometry,
    },
    inputs.scenario && {
      port: "scenario",
      kind: EntityKind.SCENARIO,
      ...inputs.scenario,
    },
    inputs.region && {
      port: "region",
      kind: EntityKind.REGION,
      ...inputs.region,
    },
  ].filter((b) => b !== undefined);
}

function scenarioBinding(inputs: FieldInputs) {
  return inputs.scenario
    ? [{ port: "scenario", kind: EntityKind.SCENARIO, ...inputs.scenario }]
    : [];
}

/** Geometry → field → T1 equilibrium → local stability (docs/UI.md 6.5). */
export function chainWorkflow(inputs: FieldInputs = {}): WorkflowInit {
  return {
    nodes: [
      step(
        "field",
        "solver",
        "nebula.field.biot_savart",
        "Biot–Savart field",
        0,
        80,
        fieldBindings(inputs),
      ),
      step(
        "t1",
        "solver",
        "nebula.equilibrium.t1",
        "T1 equilibrium",
        300,
        80,
        scenarioBinding(inputs),
      ),
      step(
        "stability",
        "solver",
        "nebula.stability.local",
        "Local stability",
        600,
        80,
      ),
    ],
    edges: [
      edge("e-1", "field", "operator", "t1", "field"),
      edge("e-2", "t1", "equilibrium", "stability", "equilibrium"),
    ],
    templateId: "wft-chain",
  };
}

/** A concept kit's default workflow, bound to its starter entities. */
function conceptWorkflow(conceptId: string, inputs: FieldInputs): WorkflowInit {
  const field = step(
    "field",
    "solver",
    "nebula.field.biot_savart",
    "Biot–Savart field",
    0,
    80,
    fieldBindings(inputs),
  );
  switch (conceptId) {
    case "nebula.concept.simple_mirror":
      return {
        nodes: [
          field,
          step(
            "lines",
            "postOp",
            "nebula.postop.field_lines",
            "Field lines",
            300,
            80,
          ),
        ],
        edges: [edge("e-1", "field", "field", "lines", "field")],
        templateId: "wft-mirror",
      };
    case "nebula.concept.stellarator":
      return {
        nodes: [
          field,
          step(
            "poincare",
            "postOp",
            "nebula.postop.poincare",
            "Poincaré",
            300,
            80,
          ),
        ],
        edges: [edge("e-1", "field", "field", "poincare", "field")],
        templateId: "wft-stellarator",
      };
    default:
      return {
        nodes: [
          field,
          step(
            "t1",
            "solver",
            "nebula.equilibrium.t1",
            "T1 equilibrium",
            300,
            80,
            scenarioBinding(inputs),
          ),
          step(
            "flux",
            "adapter",
            "nebula.adapter.flux_coordinates",
            "Flux coordinates",
            600,
            80,
          ),
          step(
            "stability",
            "solver",
            "nebula.stability.global",
            "Global stability",
            900,
            80,
          ),
        ],
        edges: [
          edge("e-1", "field", "operator", "t1", "field"),
          edge("e-2", "t1", "equilibrium", "flux", "equilibrium"),
          edge("e-3", "flux", "equilibrium", "stability", "equilibrium"),
        ],
        templateId: "wft-tokamak",
      };
  }
}

/** Workflow templates: standard chains and concept defaults (D50, D86). */
export function workflowTemplateFixtures(): WorkflowTemplate[] {
  const template = (init: MessageInitShape<typeof WorkflowTemplateSchema>) =>
    create(WorkflowTemplateSchema, init);
  return [
    template({
      id: "wft-chain",
      name: "Field, equilibrium and stability",
      description: "Geometry → field → T1 equilibrium → local stability.",
      workflow: chainWorkflow(),
    }),
    template({
      id: "wft-stored-stability",
      name: "Stability from a stored equilibrium",
      description:
        "Local stability of an equilibrium committed by an earlier run.",
      workflow: {
        nodes: [
          {
            id: "stored",
            label: "Stored equilibrium",
            layout: { x: 0, y: 80 },
            kind: { case: "storedOutput", value: { subContract: SUB.axisym } },
          },
          step(
            "stability",
            "solver",
            "nebula.stability.local",
            "Local stability",
            300,
            80,
          ),
        ],
        edges: [edge("e-1", "stored", "output", "stability", "equilibrium")],
        templateId: "wft-stored-stability",
      },
    }),
    template({
      id: "wft-transport",
      name: "Transport with stability per time slice",
      description:
        "Transport evolution, then local stability mapped over its equilibria.",
      workflow: {
        nodes: [
          {
            id: "stored",
            label: "Stored equilibrium",
            layout: { x: 0, y: 80 },
            kind: { case: "storedOutput", value: { subContract: SUB.axisym } },
          },
          step(
            "transport",
            "solver",
            "nebula.evolution.transport",
            "Transport evolution",
            300,
            80,
          ),
          {
            id: "slices",
            label: "Per time slice",
            layout: { x: 600, y: 20 },
            kind: { case: "fanOut", value: {} },
          },
          {
            ...step(
              "stability",
              "solver",
              "nebula.stability.local",
              "Local stability",
              40,
              60,
            ),
            parentId: "slices",
          },
        ],
        edges: [
          edge("e-1", "stored", "output", "transport", "equilibrium"),
          edge("e-2", "transport", "equilibria", "stability", "equilibrium"),
        ],
        templateId: "wft-transport",
      },
    }),
    ...(
      [
        ["nebula.concept.tokamak", "wft-tokamak", "Tokamak default"],
        ["nebula.concept.simple_mirror", "wft-mirror", "Simple mirror default"],
        [
          "nebula.concept.stellarator",
          "wft-stellarator",
          "Stellarator default",
        ],
      ] as const
    ).map(([conceptId, id, name]) =>
      template({
        id,
        name,
        description: "The concept kit's default workflow.",
        conceptId,
        workflow: conceptWorkflow(conceptId, {}),
      }),
    ),
  ];
}

const regionFixture = (init: MessageInitShape<typeof RegionSchema>) =>
  pack(RegionSchema, init);
const scenarioFixture = (init: MessageInitShape<typeof ScenarioSchema>) =>
  pack(ScenarioSchema, init);
const plasma = (init: MessageInitShape<typeof PlasmaTargetsSchema>) =>
  anyPack(PlasmaTargetsSchema, create(PlasmaTargetsSchema, init));

/** Setup entities of a project created from a concept starter. */
export function starterSetup(
  projectId: string,
  conceptId: string,
): EntityRecord[] {
  const geometry = entityRef(EntityKind.GEOMETRY, "geo-main");
  const records: EntityRecord[] = [];
  const add = (
    kind: EntityKind,
    id: string,
    name: string,
    content: ReturnType<typeof pack>,
  ) => records.push(entity(projectId, { kind, id, name, content }));
  switch (conceptId) {
    case "nebula.concept.simple_mirror":
      add(
        EntityKind.REGION,
        "reg-axis",
        "Axis line",
        regionFixture({
          geometry,
          shape: {
            case: "line",
            value: { start: { z: -4 }, end: { z: 4 }, samples: 201 },
          },
        }),
      );
      add(
        EntityKind.SCENARIO,
        "scn-steady",
        "Steady state",
        scenarioFixture({
          geometry,
          currents: [{ circuitId: "ckt-mirror", current: 2.0e5 }],
        }),
      );
      break;
    case "nebula.concept.stellarator":
      add(
        EntityKind.REGION,
        "reg-volume",
        "Plasma volume",
        regionFixture({
          geometry,
          shape: {
            case: "toroidalGrid",
            value: {
              majorRadius: 5.5,
              minorRadius: 0.6,
              phiMax: 2 * Math.PI,
              nrho: 16,
              ntheta: 32,
              nphi: 40,
            },
          },
        }),
      );
      add(
        EntityKind.SCENARIO,
        "scn-steady",
        "Steady state",
        scenarioFixture({
          geometry,
          currents: [{ circuitId: "ckt-modular", current: 1.2e6 }],
        }),
      );
      break;
    default:
      add(
        EntityKind.REGION,
        "reg-midplane",
        "Poloidal plane",
        regionFixture({
          geometry,
          shape: {
            case: "plane",
            value: {
              center: { x: 6.2 },
              normal: { y: 1 },
              uAxis: { x: 1 },
              width: 8,
              height: 14,
              nu: 64,
              nv: 96,
            },
          },
        }),
      );
      add(
        EntityKind.SCENARIO,
        "scn-flattop",
        "Flat-top",
        scenarioFixture({
          geometry,
          currents: [
            { circuitId: "ckt-pf", current: 4.5e4 },
            { circuitId: "ckt-cs", current: -3.0e4 },
            { circuitId: "ckt-div", current: 2.0e4 },
          ],
          plasmaTargets: [
            plasma({
              plasmaCurrent: 1.5e7,
              betaPoloidal: 0.65,
              internalInductance: 0.85,
              axisR: 6.4,
            }),
          ],
        }),
      );
      add(
        EntityKind.CONDUCTOR_NETWORK,
        "cn-passive",
        "Passive structures",
        pack(ConductorNetworkSchema, {
          geometry,
          elements: [
            {
              id: "el-vessel",
              name: "Vacuum vessel",
              componentId: "cmp-vessel",
              model: 1,
              resistivity: 7.4e-7,
              thickness: 0.06,
              discretization: {
                maxEdgeLength: 0.2,
                toroidalSegments: 64,
                poloidalSegments: 32,
              },
            },
          ],
        }),
      );
  }
  const scenario = records.find((r) => r.draft.kind === EntityKind.SCENARIO)!;
  const region = records.find((r) => r.draft.kind === EntityKind.REGION)!;
  add(
    EntityKind.WORKFLOW,
    "wf-default",
    "Concept default",
    pack(
      WorkflowSchema,
      conceptWorkflow(conceptId, {
        geometry: { id: "geo-main" },
        scenario: { id: scenario.draft.id },
        region: { id: region.draft.id },
      }),
    ),
  );
  return records;
}

/** Setup entities of the baseline fixture project, with versions. */
export function baselineSetup(): EntityRecord[] {
  const p = "p-baseline";
  const geoV2 = entityRef(EntityKind.GEOMETRY, "geo-main", {
    pinned: "sha256:geo-v2",
  });
  const plane = regionFixture({
    geometry: geoV2,
    shape: {
      case: "plane",
      value: {
        center: { x: 6.2 },
        normal: { y: 1 },
        uAxis: { x: 1 },
        width: 8,
        height: 14,
        nu: 64,
        nv: 96,
      },
    },
  });
  const box = regionFixture({
    geometry: geoV2,
    shape: {
      case: "boxGrid",
      value: {
        min: { x: 3.5, y: -2, z: -5 },
        max: { x: 9, y: 2, z: 5 },
        nx: 24,
        ny: 16,
        nz: 32,
      },
    },
  });
  const survey = pack(WorkflowSchema, surveyWorkflow());
  const flattop = (pf: number, feed = false) =>
    scenarioFixture({
      geometry: feed ? entityRef(EntityKind.GEOMETRY, "geo-main") : geoV2,
      currents: [
        { circuitId: "ckt-pf", current: pf },
        // The draft feeds the circuit geo-main's draft added since geo-v2.
        ...(feed ? [{ circuitId: "ckt-feed", current: 1.0e3 }] : []),
      ],
      plasmaTargets: [
        plasma({
          plasmaCurrent: 1.5e7,
          betaPoloidal: 0.6,
          internalInductance: 0.8,
          axisR: 6.3,
        }),
      ],
      conductorNetwork: entityRef(EntityKind.CONDUCTOR_NETWORK, "cn-vessel", {
        pinned: "sha256:cn-v1",
      }),
    });
  const network = pack(ConductorNetworkSchema, {
    geometry: geoV2,
    elements: [
      {
        id: "el-vessel",
        name: "Vacuum vessel",
        componentId: "cmp-vessel",
        model: 1,
        resistivity: 7.4e-7,
        thickness: 0.06,
        discretization: {
          maxEdgeLength: 0.2,
          toroidalSegments: 64,
          poloidalSegments: 32,
        },
      },
    ],
    circuits: [
      {
        circuitId: "ckt-pf",
        resistance: 1e-3,
        inductance: 0.05,
        supplyId: "sup-pf",
      },
    ],
    supplies: [
      {
        id: "sup-pf",
        name: "PF supply",
        voltageLimit: 1500,
        currentLimit: 6e4,
      },
    ],
  });
  const chain = (version: "v1" | "v2") =>
    pack(
      WorkflowSchema,
      chainWorkflow({
        geometry: {
          id: "geo-main",
          state: { pinned: `sha256:geo-${version}` },
        },
        scenario: {
          id: "scn-flattop",
          state: { pinned: `sha256:scn-${version}` },
        },
        region: { id: "reg-midplane", state: { pinned: "sha256:reg-v1" } },
      }),
    );
  return [
    entity(p, {
      kind: EntityKind.REGION,
      id: "reg-midplane",
      name: "Poloidal plane",
      revision: 2,
      content: plane,
      versions: [version("sha256:reg-v1", "2026-09-10T12:00:00Z", "r-03", 2)],
      versionContents: { "sha256:reg-v1": plane },
    }),
    entity(p, {
      kind: EntityKind.REGION,
      id: "reg-box",
      name: "Plasma box",
      content: box,
      versions: [version("sha256:box-v1", "2026-10-25T09:00:00Z", "r-14", 1)],
      versionContents: { "sha256:box-v1": box },
    }),
    entity(p, {
      kind: EntityKind.WORKFLOW,
      id: "wf-survey",
      name: "Survey",
      content: survey,
      versions: [
        version("sha256:survey-v1", "2026-10-25T09:00:00Z", "r-14", 1),
      ],
      versionContents: { "sha256:survey-v1": survey },
    }),
    entity(p, {
      kind: EntityKind.REGION,
      id: "reg-probe-line",
      name: "Outboard probe line",
      content: regionFixture({
        geometry: entityRef(EntityKind.GEOMETRY, "geo-main"),
        shape: {
          case: "line",
          value: { start: { x: 4 }, end: { x: 9 }, samples: 101 },
        },
      }),
    }),
    entity(p, {
      kind: EntityKind.SCENARIO,
      id: "scn-flattop",
      name: "Flat-top",
      revision: 5,
      content: flattop(4.6e4, true),
      versions: [
        version("sha256:scn-v2", "2026-10-20T12:00:00Z", "r-11", 4),
        version("sha256:scn-v1", "2026-09-10T12:00:00Z", "r-03", 2),
      ],
      versionContents: {
        "sha256:scn-v2": flattop(4.6e4),
        "sha256:scn-v1": flattop(4.2e4),
      },
    }),
    entity(p, {
      kind: EntityKind.CONDUCTOR_NETWORK,
      id: "cn-vessel",
      name: "Vessel and PF supply",
      revision: 2,
      content: network,
      versions: [version("sha256:cn-v1", "2026-09-10T12:00:00Z", "r-03", 2)],
      versionContents: { "sha256:cn-v1": network },
    }),
    entity(p, {
      kind: EntityKind.WORKFLOW,
      id: "wf-scratch",
      name: "Field on the draft assembly",
      revision: 2,
      content: pack(WorkflowSchema, {
        nodes: [
          step(
            "field",
            "solver",
            "nebula.field.biot_savart",
            "Biot–Savart field",
            0,
            80,
            fieldBindings({
              geometry: { id: "geo-main" },
              scenario: { id: "scn-flattop" },
            }),
          ),
        ],
      }),
    }),
    entity(p, {
      kind: EntityKind.WORKFLOW,
      id: "wf-chain",
      name: "Field to stability",
      revision: 5,
      content: chain("v2"),
      versions: [
        version("sha256:wf-v2", "2026-10-20T12:00:00Z", "r-11", 5),
        version("sha256:wf-v1", "2026-09-10T12:00:00Z", "r-03", 3),
      ],
      versionContents: {
        "sha256:wf-v2": chain("v2"),
        "sha256:wf-v1": chain("v1"),
      },
    }),
  ];
}

export function runFixtures(): Run[] {
  const run = (init: MessageInitShape<typeof RunSchema>) =>
    create(RunSchema, init);
  return [
    run({
      id: "r-12",
      projectId: "p-baseline",
      name: "Field to stability #12",
      workflowId: "wf-chain",
      workflowVersionHash: "sha256:wf-v2",
      state: RunState.RUNNING,
      // Fast mode is part of the cache key, so it does not reuse r-11.
      mode: DeterminismMode.FAST,
      submittedAt: at("2026-10-30T07:40:00Z"),
    }),
    run({
      id: "r-14",
      projectId: "p-baseline",
      name: "Survey #14",
      workflowId: "wf-survey",
      workflowVersionHash: "sha256:survey-v1",
      state: RunState.COMPLETED,
      submittedAt: at("2026-10-25T09:00:00Z"),
      finishedAt: at("2026-10-25T09:30:00Z"),
    }),
    run({
      id: "r-11",
      projectId: "p-baseline",
      name: "Field to stability #11",
      workflowId: "wf-chain",
      workflowVersionHash: "sha256:wf-v2",
      state: RunState.COMPLETED,
      submittedAt: at("2026-10-20T12:00:00Z"),
      finishedAt: at("2026-10-20T12:41:00Z"),
    }),
    run({
      id: "r-03",
      projectId: "p-baseline",
      name: "Field to stability #3",
      workflowId: "wf-chain",
      workflowVersionHash: "sha256:wf-v1",
      state: RunState.COMPLETED,
      submittedAt: at("2026-09-10T12:00:00Z"),
      finishedAt: at("2026-09-10T12:35:00Z"),
    }),
    ...[1, 2, 3, 4].map((n) =>
      run({
        id: `r-b${n}`,
        projectId: "p-imported",
        name: `Lab B run ${n}`,
        state: RunState.COMPLETED,
        submittedAt: at(`2026-09-0${n}T10:00:00Z`),
        finishedAt: at(`2026-09-0${n}T11:00:00Z`),
        tags: [ProvenanceTag.NOT_REPRODUCIBLE_HERE],
      }),
    ),
  ];
}

/** A committed output with one HDF5 dataset (A§5.2). */
export interface OutputExtra {
  kind?: OutputKind;
  regionType?: RegionType;
  regionId?: string;
  scalars?: Any;
  /** Slices of a time-series output, in seconds. */
  times?: number[];
}

/** A committed output with one HDF5 dataset (A§5.2). */
export function committedOutput(
  runId: string,
  nodeId: string,
  name: string,
  subContract: string,
  iso: string,
  extra: OutputExtra = {},
): RunOutput {
  const contentHash = `sha256:${runId}-${nodeId}-${name}`;
  return create(RunOutputSchema, {
    runId,
    nodeId,
    name,
    subContract,
    contentHash,
    timeSeries: Boolean(extra.times),
    committedAt: at(iso),
    kind: extra.kind,
    regionType: extra.regionType,
    regionId: extra.regionId,
    scalars: extra.scalars,
    attempt: 1,
    time: extra.times ? { base: "scenario", times: extra.times } : undefined,
    datasets: [
      {
        owner: runId,
        filePath: `runs/${runId}/${nodeId}.h5`,
        datasetPath: `/${name}`,
        contentHash,
      },
    ],
  });
}

/** Equilibrium scalars (A§13.7 comparison uses them). */
export function equilibriumScalars(
  init: MessageInitShape<typeof EquilibriumScalarsSchema>,
): Any {
  return anyPack(
    EquilibriumScalarsSchema,
    create(EquilibriumScalarsSchema, init),
  );
}

const TRANSPORT_TIMES = Array.from({ length: 10 }, (_, i) => i * 0.5);

/** The committed outputs of the completed fixture Runs. */
export function outputFixtures(): RunOutput[] {
  const out = committedOutput;
  const chain = (
    runId: string,
    day: string,
    scalars: MessageInitShape<typeof EquilibriumScalarsSchema>,
  ) => [
    out(runId, "field", "field", SUB.fieldSampled, `${day}T12:10:00Z`, {
      kind: OutputKind.REGION_FIELD,
      regionType: RegionType.PLANE,
      regionId: "reg-midplane",
    }),
    out(runId, "field", "operator", SUB.fieldOperator, `${day}T12:10:00Z`, {
      kind: OutputKind.FIELD_OPERATOR,
    }),
    out(runId, "t1", "equilibrium", SUB.axisym, `${day}T12:25:00Z`, {
      kind: OutputKind.FLUX_SURFACES,
    }),
    out(runId, "t1", "lcfs", SUB.boundary, `${day}T12:25:00Z`, {
      kind: OutputKind.SURFACE,
    }),
    out(runId, "t1", "scalars", SUB.scalars, `${day}T12:25:00Z`, {
      kind: OutputKind.SCALARS,
      scalars: equilibriumScalars(scalars),
    }),
    out(runId, "stability", "growth_rates", SUB.spectrum, `${day}T12:35:00Z`, {
      kind: OutputKind.SPECTRUM,
    }),
  ];
  return [
    // r-03 and r-11 differ beyond tolerance in q95 only (D43, P6).
    ...chain("r-03", "2026-09-10", {
      plasmaCurrent: 1.5e7,
      q95: 3.02,
      betaPoloidal: 0.6402,
      internalInductance: 0.8001,
      axisR: 6.312,
      storedEnergy: 3.512e8,
    }),
    ...chain("r-11", "2026-10-20", {
      plasmaCurrent: 1.5e7,
      q95: 3.31,
      betaPoloidal: 0.6403,
      internalInductance: 0.8,
      axisR: 6.3121,
      storedEnergy: 3.5121e8,
    }),
    ...surveyOutputs(),
  ];
}

/** Outputs of r-14, a survey covering every viewer of the catalogue. */
function surveyOutputs(): RunOutput[] {
  const out = (
    nodeId: string,
    name: string,
    subContract: string,
    extra: OutputExtra,
  ) =>
    committedOutput(
      "r-14",
      nodeId,
      name,
      subContract,
      "2026-10-25T09:30:00Z",
      extra,
    );
  return [
    out("field", "field", SUB.fieldSampled, {
      kind: OutputKind.REGION_FIELD,
      regionType: RegionType.BOX_GRID,
      regionId: "reg-box",
    }),
    out("field", "operator", SUB.fieldOperator, {
      kind: OutputKind.FIELD_OPERATOR,
    }),
    out("poincare", "poincare", SUB.derived, { kind: OutputKind.FIELD_LINES }),
    out("t1", "equilibrium", SUB.axisym, { kind: OutputKind.FLUX_SURFACES }),
    out("t1", "scalars", SUB.scalars, {
      kind: OutputKind.SCALARS,
      scalars: equilibriumScalars({
        plasmaCurrent: 1.5e7,
        q95: 3.3,
        betaPoloidal: 0.64,
        internalInductance: 0.8,
        axisR: 6.31,
        storedEnergy: 3.51e8,
      }),
    }),
    out("stability", "modes", SUB.modes, { kind: OutputKind.EIGENMODE }),
    out("stability", "growth_rates", SUB.spectrum, {
      kind: OutputKind.SPECTRUM,
    }),
    out("transport", "profiles", SUB.profiles, {
      kind: OutputKind.PROFILE,
      times: TRANSPORT_TIMES,
    }),
    out("transport", "equilibria", SUB.axisym, {
      kind: OutputKind.FLUX_SURFACES,
      times: TRANSPORT_TIMES,
    }),
  ];
}

/** Geometry → field (box grid) → Poincaré; T1 → flux → global; transport. */
export function surveyWorkflow(): WorkflowInit {
  const pinned = (id: string, hash: string) => ({
    id,
    state: { pinned: hash } as const,
  });
  const geometry = pinned("geo-main", "sha256:geo-v2");
  const scenario = pinned("scn-flattop", "sha256:scn-v2");
  return {
    nodes: [
      step(
        "field",
        "solver",
        "nebula.field.biot_savart",
        "Biot–Savart field",
        0,
        80,
        fieldBindings({
          geometry,
          scenario,
          region: pinned("reg-box", "sha256:box-v1"),
        }),
      ),
      step("poincare", "postOp", "nebula.postop.poincare", "Poincaré", 300, 0),
      step(
        "t1",
        "solver",
        "nebula.equilibrium.t1",
        "T1 equilibrium",
        300,
        160,
        scenarioBinding({ scenario }),
      ),
      step(
        "flux",
        "adapter",
        "nebula.adapter.flux_coordinates",
        "Flux coordinates",
        600,
        160,
      ),
      step(
        "stability",
        "solver",
        "nebula.stability.global",
        "Global stability",
        900,
        160,
      ),
      step(
        "transport",
        "solver",
        "nebula.evolution.transport",
        "Transport evolution",
        600,
        320,
        scenarioBinding({ scenario }),
      ),
    ],
    edges: [
      edge("e-1", "field", "field", "poincare", "field"),
      edge("e-2", "field", "operator", "t1", "field"),
      edge("e-3", "t1", "equilibrium", "flux", "equilibrium"),
      edge("e-4", "flux", "equilibrium", "stability", "equilibrium"),
      edge("e-5", "t1", "equilibrium", "transport", "equilibrium"),
    ],
  };
}

export interface InputRecord {
  projectId: string;
  dataset: InputDataset;
}

export function inputFixtures(): InputRecord[] {
  return [
    {
      projectId: "p-baseline",
      dataset: create(InputDatasetSchema, {
        id: "in-shot4521",
        name: "Reconstructed equilibrium, shot 4521",
        subContract: SUB.axisym,
        versionHash: "sha256:in-shot4521",
        sizeBytes: 3_145_728n,
        uploadedAt: at("2026-10-05T09:00:00Z"),
        dataset: {
          owner: "in-shot4521",
          filePath: "inputs/in-shot4521.h5",
          datasetPath: "/equilibrium",
          contentHash: "sha256:in-shot4521",
        },
      }),
    },
  ];
}
