import {
  create,
  type DescMessage,
  type MessageInitShape,
} from "@bufbuild/protobuf";
import { base64Decode } from "@bufbuild/protobuf/wire";
import { anyPack, timestampFromDate, type Any } from "@bufbuild/protobuf/wkt";
import {
  CircularFilamentSchema,
  CircularWindingPackSchema,
  ComponentSchema,
  CylindricalShellSchema,
  FourierModeSchema,
  FourierSurfaceSchema,
  PolylineFilamentSchema,
  SplineCurveSchema,
  ToroidalShellSchema,
} from "../gen/nebula/core/v1/component_pb";
import {
  EntityDraftSchema,
  EntityKind,
  EntityRefSchema,
  LibrarySourceSchema,
  MintedBy,
  VersionMetaSchema,
  type EntityDraft,
  type EntityRef,
  type LibrarySource,
  type VersionMeta,
} from "../gen/nebula/core/v1/entity_pb";
import {
  CircuitSchema,
  GeometrySchema,
  SymmetrySchema,
} from "../gen/nebula/core/v1/geometry_pb";
import {
  LibraryComponentSchema,
  LibraryMaterialSchema,
  type LibraryComponent,
  type LibraryMaterial,
} from "../gen/nebula/core/v1/library_pb";
import {
  MaterialPropertiesSchema,
  MaterialSchema,
  type Material,
} from "../gen/nebula/core/v1/material_pb";
import {
  ExtensionKind,
  PluginInfoSchema,
  PluginOrigin,
  SmokeResult,
  type PluginInfo,
} from "../gen/nebula/core/v1/plugin_pb";
import {
  ProjectSchema,
  TemplateKind,
  TemplateSchema,
  type Project,
  type Template,
} from "../gen/nebula/core/v1/project_pb";
import { SchemaRegistry } from "../schema/registry";
import { acmeDemoDescriptorSet } from "./fixtures/acme-demo";
import { fourierPoint } from "./tessellate";

// Fixtures are built with the generated types so they stay schema-correct
// (docs/UI.md Section 7).

const at = (iso: string) => timestampFromDate(new Date(iso));

const abi = {
  compiler: "clang 19.1",
  stdlib: "libstdc++ 14",
  gpuRuntime: "ROCm 7.1",
  nebulaAbi: "1",
};

export const conceptKits = [
  { id: "nebula.concept.tokamak", name: "Tokamak" },
  { id: "nebula.concept.simple_mirror", name: "Simple mirror" },
  { id: "nebula.concept.stellarator", name: "Stellarator" },
] as const;

// Core GeometryComponent shapes (A§10.1), registered by the core plugin.
const coreShapes = [
  ["circular_filament", "Circular filament", CircularFilamentSchema],
  ["polyline_filament", "Polyline filament", PolylineFilamentSchema],
  ["spline_curve", "Spline curve", SplineCurveSchema],
  ["fourier_surface", "Fourier surface", FourierSurfaceSchema],
  ["circular_winding_pack", "Circular winding pack", CircularWindingPackSchema],
  ["toroidal_shell", "Toroidal shell", ToroidalShellSchema],
  ["cylindrical_shell", "Cylindrical shell", CylindricalShellSchema],
] as const;

export function pluginFixtures(): PluginInfo[] {
  return [
    create(PluginInfoSchema, {
      id: "nebula.core",
      version: "1.0.0",
      origin: PluginOrigin.CORE,
      abi,
      soHash: "sha256:core0000",
      extensions: [
        ...coreShapes.map(([name, displayName, schema]) => ({
          id: `nebula.component.${name}`,
          kind: ExtensionKind.GEOMETRY_COMPONENT,
          displayName,
          configMessage: schema.typeName,
        })),
        ...conceptKits.map((kit) => ({
          id: kit.id,
          kind: ExtensionKind.CONCEPT,
          displayName: kit.name,
        })),
      ],
      smoke: [{ gpuModel: "MI300X", result: SmokeResult.PASSED }],
    }),
    create(PluginInfoSchema, {
      id: "acme.demo",
      version: "1.2.0",
      origin: PluginOrigin.PLUGIN,
      abi,
      soHash: "sha256:acme1200",
      extensions: [
        {
          id: "acme.demo.solver",
          kind: ExtensionKind.SOLVER,
          displayName: "Demo solver",
          calculationType: "equilibrium",
          configMessage: "acme.demo.v1.DemoSolverConfig",
          subContracts: ["Equilibrium.Axisym2D"],
        },
        {
          id: "acme.demo.saddle_coil",
          kind: ExtensionKind.GEOMETRY_COMPONENT,
          displayName: "Saddle coil",
          configMessage: "acme.demo.v1.SaddleCoil",
        },
      ],
      descriptorSet: base64Decode(acmeDemoDescriptorSet),
      smoke: [
        { gpuModel: "MI300X", result: SmokeResult.PASSED },
        {
          gpuModel: "W7900",
          result: SmokeResult.FAILED,
          detail: "Residual above tolerance",
        },
      ],
    }),
  ];
}

/** Schema the mock uses to pack and encode plugin content. */
export const mockSchema = new SchemaRegistry(pluginFixtures());

export function templateFixtures(): Template[] {
  return conceptKits.map((kit) =>
    create(TemplateSchema, {
      id: `tpl-${kit.id.split(".").pop()}`,
      name: `${kit.name} starter`,
      description: `Starter project of the ${kit.name.toLowerCase()} concept kit.`,
      kind: TemplateKind.CONCEPT_STARTER,
      concept: { conceptId: kit.id, version: "1.0.0" },
    }),
  );
}

export function projectFixtures(): Project[] {
  return [
    create(ProjectSchema, {
      id: "p-baseline",
      name: "Tokamak baseline",
      description: "Reference tokamak with a 12-coil TF set.",
      concept: { conceptId: "nebula.concept.tokamak", version: "1.0.0" },
      settings: {},
      createdAt: at("2026-09-01T09:00:00Z"),
      updatedAt: at("2026-10-28T16:20:00Z"),
      runCount: 12,
    }),
    create(ProjectSchema, {
      id: "p-imported",
      name: "Stellarator from lab B",
      description: "Imported from another installation.",
      concept: { conceptId: "nebula.concept.stellarator", version: "1.0.0" },
      settings: {},
      createdAt: at("2026-10-02T10:00:00Z"),
      updatedAt: at("2026-10-02T10:00:00Z"),
      runCount: 4,
      nonReproducibleRunCount: 4,
    }),
  ];
}

export interface EntityRecord {
  projectId: string;
  draft: EntityDraft;
  /** Newest first. */
  versions: VersionMeta[];
  /** Content of each version by hash, for pinned and latest references. */
  versionContents?: Record<string, Any>;
}

/** A project material (A§13.2): a plain resource, not a draft entity. */
export interface MaterialRecord {
  projectId: string;
  material: Material;
}

/** The user-global library (D88). */
export interface LibraryState {
  components: LibraryComponent[];
  materials: LibraryMaterial[];
}

function pack<Desc extends DescMessage>(
  schema: Desc,
  init: MessageInitShape<Desc>,
) {
  return anyPack(schema, create(schema, init));
}

function version(
  hash: string,
  iso: string,
  sourceId: string,
  draftRevision: number,
): VersionMeta {
  return create(VersionMetaSchema, {
    hash,
    mintedAt: at(iso),
    mintedBy: MintedBy.RUN_SUBMISSION,
    sourceId,
    draftRevision,
  });
}

interface RecordInit {
  kind: EntityKind;
  id: string;
  name: string;
  content?: Any;
  revision?: number;
  updatedAt?: string;
  versions?: VersionMeta[];
  versionContents?: Record<string, Any>;
}

function entity(projectId: string, init: RecordInit): EntityRecord {
  return {
    projectId,
    draft: create(EntityDraftSchema, {
      kind: init.kind,
      id: init.id,
      name: init.name,
      revision: init.revision ?? 1,
      updatedAt: at(init.updatedAt ?? "2026-10-30T08:00:00Z"),
      content: init.content,
    }),
    versions: init.versions ?? [],
    versionContents: init.versionContents,
  };
}

/** COMPONENT content: the `Component` wrapper around a shape (A§4.1). */
function component<Desc extends DescMessage>(
  schema: Desc,
  init: MessageInitShape<Desc>,
  materialId = "",
  source?: LibrarySource,
): Any {
  return pack(ComponentSchema, {
    shape: pack(schema, init),
    materialId,
    source,
  });
}

type RefState = "draft" | "latest" | { pinned: string };

export function componentRef(id: string, state: RefState = "draft"): EntityRef {
  return create(EntityRefSchema, {
    kind: EntityKind.COMPONENT,
    id,
    state:
      state === "draft"
        ? { case: "draft", value: {} }
        : state === "latest"
          ? { case: "latest", value: {} }
          : { case: "pinned", value: { versionHash: state.pinned } },
  });
}

function geometry(
  symmetry: MessageInitShape<typeof SymmetrySchema> | undefined,
  components: EntityRef[],
  circuits: MessageInitShape<typeof CircuitSchema>[] = [],
): Any {
  return pack(GeometrySchema, { symmetry, components, circuits });
}

// User-global library (D88). Room-temperature SI properties.

const COPPER: MessageInitShape<typeof MaterialPropertiesSchema> = {
  density: 8960,
  electricalConductivity: 5.96e7,
  thermalConductivity: 401,
  specificHeat: 385,
  youngsModulus: 1.17e11,
  poissonRatio: 0.34,
};

const SS316L: MessageInitShape<typeof MaterialPropertiesSchema> = {
  density: 7990,
  electricalConductivity: 1.35e6,
  thermalConductivity: 16.3,
  specificHeat: 500,
  youngsModulus: 1.93e11,
  poissonRatio: 0.3,
};

const NB3SN: MessageInitShape<typeof MaterialPropertiesSchema> = {
  density: 8950,
  electricalConductivity: 1.4e6,
  thermalConductivity: 4,
  specificHeat: 230,
  youngsModulus: 1.4e11,
  poissonRatio: 0.36,
};

export function libraryFixtures(): LibraryState {
  return {
    materials: [
      create(LibraryMaterialSchema, {
        id: "lib-mat-copper",
        name: "Copper",
        description: "Oxygen-free high-conductivity copper.",
        properties: COPPER,
      }),
      create(LibraryMaterialSchema, {
        id: "lib-mat-ss316",
        name: "SS316L",
        description: "Austenitic stainless steel for vacuum vessels.",
        properties: SS316L,
      }),
      create(LibraryMaterialSchema, {
        id: "lib-mat-nb3sn",
        name: "Nb3Sn",
        description: "Niobium-tin superconductor, normal-state properties.",
        properties: NB3SN,
      }),
    ],
    components: [
      create(LibraryComponentSchema, {
        id: "lib-cmp-pf-coil",
        name: "PF coil (generic)",
        description: "Copper poloidal field coil with a rectangular pack.",
        component: {
          shape: pack(CircularWindingPackSchema, {
            majorRadius: 4,
            height: 6,
            radialWidth: 0.6,
            verticalHeight: 0.8,
            segments: 128,
          }),
          materialId: "lib-mat-copper",
        },
      }),
      create(LibraryComponentSchema, {
        id: "lib-cmp-vessel",
        name: "Vacuum vessel",
        description: "Single-wall elongated toroidal vessel.",
        component: {
          shape: pack(ToroidalShellSchema, {
            majorRadius: 6.2,
            minorRadius: 2.4,
            elongation: 1.7,
            thickness: 0.06,
            segments: 64,
          }),
          materialId: "lib-mat-ss316",
        },
      }),
      create(LibraryComponentSchema, {
        id: "lib-cmp-feed",
        name: "Feed loop",
        description: "Closed rectangular feed loop.",
        component: {
          shape: pack(PolylineFilamentSchema, {
            points: [
              { x: 2, y: 0, z: 8 },
              { x: 4, y: 0, z: 8 },
              { x: 4, y: 0, z: 9 },
              { x: 2, y: 0, z: 9 },
            ],
            closed: true,
          }),
        },
      }),
    ],
  };
}

/** A project copy of a library material, linked to its entry (D88). */
function importedMaterial(
  projectId: string,
  id: string,
  entryId: string,
): MaterialRecord {
  const entry = libraryFixtures().materials.find((m) => m.id === entryId)!;
  return {
    projectId,
    material: create(MaterialSchema, {
      id,
      name: entry.name,
      properties: entry.properties,
      source: create(LibrarySourceSchema, {
        entryId,
        entryName: entry.name,
        importedAt: at("2026-09-01T09:05:00Z"),
      }),
    }),
  };
}

export function materialFixtures(): MaterialRecord[] {
  return [
    importedMaterial("p-baseline", "m-ss316", "lib-mat-ss316"),
    {
      projectId: "p-baseline",
      material: create(MaterialSchema, {
        id: "m-copper",
        name: "Copper",
        properties: COPPER,
      }),
    },
  ];
}

// Concept starters. Every starter geometry tessellates without errors.

/** Materials of a project created from a concept starter. */
export function starterMaterials(projectId: string): MaterialRecord[] {
  return [
    importedMaterial(projectId, "m-copper", "lib-mat-copper"),
    importedMaterial(projectId, "m-ss316", "lib-mat-ss316"),
    importedMaterial(projectId, "m-nb3sn", "lib-mat-nb3sn"),
  ];
}

const TOKAMAK_VESSEL: MessageInitShape<typeof ToroidalShellSchema> = {
  majorRadius: 6.2,
  minorRadius: 2.4,
  elongation: 1.7,
  thickness: 0.06,
  segments: 64,
};

function tokamakStarter(projectId: string): EntityRecord[] {
  const pf = [
    { id: "cmp-pf1", name: "PF1", r: 3.9, z: 7.6, turns: 248 },
    { id: "cmp-pf2", name: "PF2", r: 8.3, z: 6.5, turns: 120 },
    { id: "cmp-pf3", name: "PF3", r: 8.3, z: -6.5, turns: 120 },
    { id: "cmp-pf4", name: "PF4", r: 3.9, z: -7.6, turns: 248 },
  ];
  const components = [
    ...pf.map((coil) =>
      entity(projectId, {
        kind: EntityKind.COMPONENT,
        id: coil.id,
        name: coil.name,
        content: component(
          CircularFilamentSchema,
          { majorRadius: coil.r, height: coil.z, segments: 128 },
          "m-copper",
        ),
      }),
    ),
    entity(projectId, {
      kind: EntityKind.COMPONENT,
      id: "cmp-cs",
      name: "Central solenoid",
      content: component(
        CircularWindingPackSchema,
        {
          majorRadius: 1.7,
          height: 0,
          radialWidth: 0.6,
          verticalHeight: 10,
          segments: 96,
        },
        "m-nb3sn",
      ),
    }),
    entity(projectId, {
      kind: EntityKind.COMPONENT,
      id: "cmp-div",
      name: "Divertor coil",
      content: component(
        CircularWindingPackSchema,
        {
          majorRadius: 5.2,
          height: -5.6,
          radialWidth: 0.5,
          verticalHeight: 0.5,
          segments: 96,
        },
        "m-copper",
      ),
    }),
    entity(projectId, {
      kind: EntityKind.COMPONENT,
      id: "cmp-vessel",
      name: "Vacuum vessel",
      content: component(ToroidalShellSchema, TOKAMAK_VESSEL, "m-ss316"),
    }),
  ];
  return [
    entity(projectId, {
      kind: EntityKind.GEOMETRY,
      id: "geo-main",
      name: "Reference assembly",
      content: geometry(
        { axisymmetric: true, fieldPeriods: 1 },
        components.map((record) => componentRef(record.draft.id)),
        [
          {
            id: "ckt-pf",
            name: "PF",
            members: pf.map((coil) => ({
              componentId: coil.id,
              turns: coil.turns,
            })),
          },
          {
            id: "ckt-cs",
            name: "CS",
            members: [{ componentId: "cmp-cs", turns: 540 }],
          },
          {
            id: "ckt-div",
            name: "Divertor",
            members: [{ componentId: "cmp-div", turns: 60 }],
          },
        ],
      ),
    }),
    ...components,
  ];
}

function mirrorStarter(projectId: string): EntityRecord[] {
  const coils = [
    { id: "cmp-coil-n", name: "Mirror coil (north)", z: 2.5 },
    { id: "cmp-coil-s", name: "Mirror coil (south)", z: -2.5 },
  ];
  const components = [
    ...coils.map((coil) =>
      entity(projectId, {
        kind: EntityKind.COMPONENT,
        id: coil.id,
        name: coil.name,
        content: component(
          CircularWindingPackSchema,
          {
            majorRadius: 0.6,
            height: coil.z,
            radialWidth: 0.2,
            verticalHeight: 0.4,
            segments: 96,
          },
          "m-copper",
        ),
      }),
    ),
    entity(projectId, {
      kind: EntityKind.COMPONENT,
      id: "cmp-vessel",
      name: "Vacuum vessel",
      content: component(
        CylindricalShellSchema,
        { radius: 0.45, length: 6, zCenter: 0, thickness: 0.02, segments: 64 },
        "m-ss316",
      ),
    }),
  ];
  return [
    entity(projectId, {
      kind: EntityKind.GEOMETRY,
      id: "geo-main",
      name: "Reference assembly",
      content: geometry(
        { axisymmetric: true, fieldPeriods: 1 },
        components.map((record) => componentRef(record.draft.id)),
        [
          {
            id: "ckt-mirror",
            name: "Mirror coils",
            members: coils.map((coil) => ({
              componentId: coil.id,
              turns: 400,
              seriesGroup: 0,
            })),
          },
        ],
      ),
    }),
    ...components,
  ];
}

const STELLARATOR_PERIODS = 5;

// A W7-X-like boundary: R0 = 5.5 m, a = 0.5 m with a helical shift.
const STELLARATOR_BOUNDARY: MessageInitShape<typeof FourierModeSchema>[] = [
  { m: 0, n: 0, rmnc: 5.5 },
  { m: 1, n: 0, rmnc: 0.5, zmns: 0.6 },
  { m: 0, n: 1, rmnc: 0.25, zmns: -0.2 },
  { m: 1, n: 1, rmnc: 0.06, zmns: -0.06 },
];

/** Points of a modular coil around the boundary at toroidal angle phi0. */
function modularCoil(phi0: number, points: number, offset = 0.45) {
  const modes = STELLARATOR_BOUNDARY.map((mode) =>
    create(FourierModeSchema, mode),
  );
  return Array.from({ length: points }, (_, i) => {
    const theta = (2 * Math.PI * i) / points;
    const phi = phi0 + 0.04 * Math.sin(theta);
    const [x, y, z] = fourierPoint(modes, STELLARATOR_PERIODS, theta, phi);
    const r = Math.hypot(x, y) + offset * Math.cos(theta);
    return {
      x: r * Math.cos(phi),
      y: r * Math.sin(phi),
      z: z + offset * Math.sin(theta),
    };
  });
}

function stellaratorStarter(projectId: string): EntityRecord[] {
  const coils = [
    { id: "cmp-mc1", name: "Modular coil 1", phi: 0.13 },
    { id: "cmp-mc2", name: "Modular coil 2", phi: 0.38 },
  ];
  const components = [
    entity(projectId, {
      kind: EntityKind.COMPONENT,
      id: "cmp-plasma",
      name: "Plasma boundary",
      content: component(FourierSurfaceSchema, {
        modes: STELLARATOR_BOUNDARY,
        fieldPeriods: STELLARATOR_PERIODS,
        poloidalPoints: 32,
        toroidalPoints: 160,
      }),
    }),
    ...coils.map((coil) =>
      entity(projectId, {
        kind: EntityKind.COMPONENT,
        id: coil.id,
        name: coil.name,
        content: component(
          PolylineFilamentSchema,
          { points: modularCoil(coil.phi, 48), closed: true },
          "m-nb3sn",
        ),
      }),
    ),
    entity(projectId, {
      kind: EntityKind.COMPONENT,
      id: "cmp-centerline",
      name: "Modular coil 3 centerline",
      content: component(SplineCurveSchema, {
        controlPoints: modularCoil(0.6, 12),
        degree: 3,
        periodic: true,
        segments: 96,
      }),
    }),
  ];
  return [
    entity(projectId, {
      kind: EntityKind.GEOMETRY,
      id: "geo-main",
      name: "Reference assembly",
      content: geometry(
        { axisymmetric: false, fieldPeriods: STELLARATOR_PERIODS },
        components.map((record) => componentRef(record.draft.id)),
        [
          {
            id: "ckt-modular",
            name: "Modular coils",
            members: coils.map((coil) => ({
              componentId: coil.id,
              turns: 108,
            })),
            replicateOverPeriods: true,
          },
        ],
      ),
    }),
    ...components,
  ];
}

/** Entities of a project created from a concept starter. */
export function starterEntities(
  projectId: string,
  conceptId: string,
): EntityRecord[] {
  switch (conceptId) {
    case "nebula.concept.simple_mirror":
      return mirrorStarter(projectId);
    case "nebula.concept.stellarator":
      return stellaratorStarter(projectId);
    default:
      return tokamakStarter(projectId);
  }
}

export function entityFixtures(): EntityRecord[] {
  const saddle = mockSchema.getMessage("acme.demo.v1.SaddleCoil");
  if (!saddle) {
    throw new Error("acme.demo fixture lacks SaddleCoil");
  }
  const p = "p-baseline";
  const pf1 = component(
    CircularFilamentSchema,
    { majorRadius: 3.9, height: 7.6, segments: 128 },
    "m-copper",
  );
  const pf2 = (majorRadius: number) =>
    component(
      CircularFilamentSchema,
      { majorRadius, height: 6.5, segments: 128 },
      "m-copper",
    );
  const pfCircuit = {
    id: "ckt-pf",
    name: "PF",
    members: [
      { componentId: "cmp-pf1", turns: 248, seriesGroup: 0 },
      { componentId: "cmp-pf2", turns: 120, seriesGroup: 0 },
    ],
  };
  const main = geometry(
    { axisymmetric: true, fieldPeriods: 1 },
    [
      componentRef("cmp-pf1"),
      componentRef("cmp-pf2", { pinned: "sha256:pf2-v1" }),
      componentRef("cmp-saddle"),
      componentRef("cmp-vessel"),
      componentRef("cmp-feed"),
      componentRef("cmp-limiter"),
    ],
    [
      pfCircuit,
      // An open lead on its own: flagged as not closed (D145).
      {
        id: "ckt-feed",
        name: "Feed",
        members: [{ componentId: "cmp-feed", turns: 1 }],
      },
    ],
  );
  return [
    entity(p, {
      kind: EntityKind.GEOMETRY,
      id: "geo-main",
      name: "Baseline assembly",
      revision: 7,
      updatedAt: "2026-10-28T16:20:00Z",
      content: main,
      versions: [
        version("sha256:geo-v2", "2026-10-20T12:00:00Z", "r-11", 6),
        version("sha256:geo-v1", "2026-09-10T12:00:00Z", "r-03", 3),
      ],
      versionContents: {
        "sha256:geo-v2": main,
        "sha256:geo-v1": geometry(
          { axisymmetric: true, fieldPeriods: 1 },
          [componentRef("cmp-pf1"), componentRef("cmp-vessel")],
          [{ ...pfCircuit, members: pfCircuit.members.slice(0, 1) }],
        ),
      },
    }),
    entity(p, {
      kind: EntityKind.GEOMETRY,
      id: "geo-alt",
      name: "Alternative assembly",
      revision: 2,
      updatedAt: "2026-10-29T08:00:00Z",
      // No symmetry: the mandatory-symmetry check flags it (D94).
      content: geometry(undefined, []),
    }),
    entity(p, {
      kind: EntityKind.COMPONENT,
      id: "cmp-pf1",
      name: "PF1",
      revision: 3,
      updatedAt: "2026-10-28T16:20:00Z",
      content: pf1,
      versions: [version("sha256:pf1-v1", "2026-10-20T12:00:00Z", "r-11", 3)],
      versionContents: { "sha256:pf1-v1": pf1 },
    }),
    entity(p, {
      kind: EntityKind.COMPONENT,
      id: "cmp-pf2",
      name: "PF2",
      revision: 2,
      updatedAt: "2026-10-27T10:00:00Z",
      content: pf2(8.3),
      // Minted from revision 1: the draft changed since head.
      versions: [version("sha256:pf2-v1", "2026-10-20T12:00:00Z", "r-11", 1)],
      versionContents: { "sha256:pf2-v1": pf2(8.2) },
    }),
    entity(p, {
      kind: EntityKind.COMPONENT,
      id: "cmp-saddle",
      name: "Saddle coil",
      updatedAt: "2026-10-29T08:00:00Z",
      content: anyPack(
        ComponentSchema,
        create(ComponentSchema, {
          shape: anyPack(
            saddle,
            create(saddle, {
              width: 0.4,
              height: 0.8,
              toroidalExtent: 0.6,
              turns: 4,
              majorRadius: 5.5,
            }),
          ),
          materialId: "m-copper",
        }),
      ),
    }),
    entity(p, {
      kind: EntityKind.COMPONENT,
      id: "cmp-vessel",
      name: "Vacuum vessel",
      content: component(ToroidalShellSchema, TOKAMAK_VESSEL, "m-ss316"),
    }),
    entity(p, {
      kind: EntityKind.COMPONENT,
      id: "cmp-feed",
      name: "Feed lead",
      content: component(
        PolylineFilamentSchema,
        {
          points: [
            { x: 4.3, y: 0, z: 7.6 },
            { x: 4.3, y: 0, z: 9.2 },
            { x: 2.2, y: 0, z: 9.2 },
          ],
          closed: false,
        },
        "m-copper",
      ),
    }),
    entity(p, {
      kind: EntityKind.COMPONENT,
      id: "cmp-limiter",
      name: "Limiter profile",
      content: component(
        SplineCurveSchema,
        {
          controlPoints: [
            { x: 8.4, y: 0, z: -1.2 },
            { x: 8.7, y: 0, z: -0.6 },
            { x: 8.8, y: 0, z: 0 },
            { x: 8.7, y: 0, z: 0.6 },
            { x: 8.4, y: 0, z: 1.2 },
          ],
          degree: 3,
          segments: 64,
        },
        "m-ss316",
      ),
    }),
  ];
}
