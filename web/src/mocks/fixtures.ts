import {
  create,
  type DescMessage,
  type MessageInitShape,
} from "@bufbuild/protobuf";
import { base64Decode } from "@bufbuild/protobuf/wire";
import { anyPack, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { CircularFilamentSchema } from "../gen/nebula/core/v1/component_pb";
import {
  EntityDraftSchema,
  EntityKind,
  MintedBy,
  VersionMetaSchema,
  type EntityDraft,
  type VersionMeta,
} from "../gen/nebula/core/v1/entity_pb";
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

export function pluginFixtures(): PluginInfo[] {
  return [
    create(PluginInfoSchema, {
      id: "nebula.core",
      version: "1.0.0",
      origin: PluginOrigin.CORE,
      abi,
      soHash: "sha256:core0000",
      extensions: [
        {
          id: "nebula.component.circular_filament",
          kind: ExtensionKind.GEOMETRY_COMPONENT,
          displayName: "Circular filament",
          configMessage: "nebula.core.v1.CircularFilament",
        },
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
}

function pack<Desc extends DescMessage>(
  schema: Desc,
  init: MessageInitShape<Desc>,
) {
  return anyPack(schema, create(schema, init));
}

function version(hash: string, iso: string, sourceId: string): VersionMeta {
  return create(VersionMetaSchema, {
    hash,
    mintedAt: at(iso),
    mintedBy: MintedBy.RUN_SUBMISSION,
    sourceId,
  });
}

/** Entities of a project created from a concept starter. */
export function starterEntities(projectId: string): EntityRecord[] {
  return [
    {
      projectId,
      draft: create(EntityDraftSchema, {
        kind: EntityKind.GEOMETRY,
        id: "geo-main",
        name: "Starter geometry",
        revision: 1,
        updatedAt: at("2026-10-30T08:00:00Z"),
      }),
      versions: [],
    },
  ];
}

export function entityFixtures(): EntityRecord[] {
  const saddle = mockSchema.getMessage("acme.demo.v1.SaddleCoil");
  if (!saddle) {
    throw new Error("acme.demo fixture lacks SaddleCoil");
  }
  return [
    {
      projectId: "p-baseline",
      draft: create(EntityDraftSchema, {
        kind: EntityKind.GEOMETRY,
        id: "geo-main",
        name: "Baseline assembly",
        revision: 7,
        updatedAt: at("2026-10-28T16:20:00Z"),
      }),
      versions: [
        version("sha256:geo-v2", "2026-10-20T12:00:00Z", "r-11"),
        version("sha256:geo-v1", "2026-09-10T12:00:00Z", "r-03"),
      ],
    },
    {
      projectId: "p-baseline",
      draft: create(EntityDraftSchema, {
        kind: EntityKind.GEOMETRY,
        id: "geo-alt",
        name: "Alternative assembly",
        revision: 2,
        updatedAt: at("2026-10-29T08:00:00Z"),
      }),
      versions: [],
    },
    {
      projectId: "p-baseline",
      draft: create(EntityDraftSchema, {
        kind: EntityKind.COMPONENT,
        id: "cmp-pf1",
        name: "PF1",
        revision: 3,
        updatedAt: at("2026-10-28T16:20:00Z"),
        content: pack(CircularFilamentSchema, {
          majorRadius: 3.9,
          height: 7.6,
          turns: 248,
          segments: 128,
        }),
      }),
      versions: [version("sha256:pf1-v1", "2026-10-20T12:00:00Z", "r-11")],
    },
    {
      projectId: "p-baseline",
      draft: create(EntityDraftSchema, {
        kind: EntityKind.COMPONENT,
        id: "cmp-saddle",
        name: "Saddle coil",
        revision: 1,
        updatedAt: at("2026-10-29T08:00:00Z"),
        content: anyPack(
          saddle,
          create(saddle, { width: 0.4, height: 0.8, turns: 4 }),
        ),
      }),
      versions: [],
    },
  ];
}
