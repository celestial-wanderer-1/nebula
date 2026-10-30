import type { EntityKind } from "../gen/nebula/core/v1/entity_pb";

// Stable query keys of the form [projectId | "global", kind, id, ...]
// (docs/UI.md Section 4.2). Invalidating a prefix covers everything below it.
export const GLOBAL = "global";

export const queryKeys = {
  version: () => [GLOBAL, "version"] as const,
  plugins: () => [GLOBAL, "plugins"] as const,
  templates: () => [GLOBAL, "templates"] as const,
  projects: () => [GLOBAL, "projects"] as const,
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
};
