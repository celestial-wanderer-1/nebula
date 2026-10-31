import { EntityKind } from "../gen/nebula/core/v1/entity_pb";

// Stable query keys of the form [projectId | "global", kind, id, ...]
// (docs/UI.md Section 4.2). Invalidating a prefix covers everything below it.
export const GLOBAL = "global";

export const queryKeys = {
  version: () => [GLOBAL, "version"] as const,
  plugins: () => [GLOBAL, "plugins"] as const,
  templates: () => [GLOBAL, "templates"] as const,
  projects: () => [GLOBAL, "projects"] as const,
  queue: () => [GLOBAL, "queue", "entries"] as const,
  queueSummary: () => [GLOBAL, "queue", "summary"] as const,
  telemetry: () => [GLOBAL, "telemetry"] as const,
  project: (projectId: string) => [projectId] as const,
  projectInfo: (projectId: string) => [projectId, "project"] as const,
  entityKind: (projectId: string, kind: EntityKind) =>
    [projectId, kind] as const,
  entities: (projectId: string, kind: EntityKind) =>
    [projectId, kind, "list"] as const,
  entity: (projectId: string, kind: EntityKind, id: string) =>
    [projectId, kind, id] as const,
  draft: (projectId: string, kind: EntityKind, id: string) =>
    [projectId, kind, id, "draft"] as const,
  versions: (projectId: string, kind: EntityKind, id: string) =>
    [projectId, kind, id, "versions"] as const,
  // Versions are immutable, so the content of one never goes stale.
  entityVersion: (
    projectId: string,
    kind: EntityKind,
    id: string,
    hash: string,
  ) => [projectId, kind, id, "versions", hash] as const,
  workflowTemplates: (projectId: string) =>
    [projectId, "workflow-templates"] as const,
  runs: (projectId: string) => [projectId, "runs", "list"] as const,
  run: (projectId: string, runId: string) =>
    [projectId, "runs", runId] as const,
  runOutputs: (projectId: string, runId: string) =>
    [projectId, "runs", runId, "outputs"] as const,
  inputs: (projectId: string) => [projectId, "inputs", "list"] as const,
  // The fingerprint names the inputs the mesh was built from, so each new
  // revision is a new query (D148).
  tessellation: (projectId: string, geometryId: string, fingerprint: string) =>
    [
      projectId,
      EntityKind.GEOMETRY,
      geometryId,
      "tessellation",
      fingerprint,
    ] as const,
  // Materials are project resources, not entities (D127).
  materials: (projectId: string) => [projectId, "materials", "list"] as const,
  material: (projectId: string, id: string) =>
    [projectId, "materials", id] as const,
  libraryComponents: () => [GLOBAL, "library", "components"] as const,
  libraryComponent: (id: string) =>
    [GLOBAL, "library", "components", id] as const,
  libraryMaterials: () => [GLOBAL, "library", "materials"] as const,
  libraryMaterial: (id: string) =>
    [GLOBAL, "library", "materials", id] as const,
};
