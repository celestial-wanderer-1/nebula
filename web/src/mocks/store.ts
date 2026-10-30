import { create, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import {
  ChangeType,
  EntityChangeSchema,
  EntitySummarySchema,
  type EntityChange,
  type EntityDraft,
  type EntityKind,
  type EntitySummary,
  type UpdateDraftRequest,
} from "../gen/nebula/core/v1/entity_pb";
import type { PluginInfo } from "../gen/nebula/core/v1/plugin_pb";
import {
  IssueSeverity,
  ProjectSchema,
  TemplateKind,
  TemplateSchema,
  ValidationIssueSchema,
  type ImportProjectResponse,
  type Project,
  type Template,
} from "../gen/nebula/core/v1/project_pb";
import {
  QueueSummarySchema,
  type QueueSummary,
} from "../gen/nebula/core/v1/queue_pb";
import {
  entityFixtures,
  pluginFixtures,
  projectFixtures,
  starterEntities,
  templateFixtures,
  type EntityRecord,
} from "./fixtures";
import { MOCK_BUILD_ID } from "./token";

const EXPORT_FORMAT = "nebula-mock-export/1";

export type DraftUpdateResult =
  { ok: true; draft: EntityDraft } | { ok: false; current: EntityDraft };

/**
 * In-memory backend state (docs/UI.md Section 7). Draft updates enforce
 * revisions; every entity change is published as the server would publish
 * it on /ws/projects/{p}/entities, whichever client made it.
 */
export class MockStore {
  projects: Project[] = [];
  templates: Template[] = [];
  plugins: PluginInfo[] = [];
  entities: EntityRecord[] = [];
  queue: QueueSummary = create(QueueSummarySchema);
  /** API version `/version` reports; scenarios change it. */
  apiVersion = "";
  private nextId = 1;
  private readonly entityListeners = new Set<(change: EntityChange) => void>();
  private readonly queueListeners = new Set<(summary: QueueSummary) => void>();

  constructor(apiVersion: string) {
    this.reset(apiVersion);
  }

  reset(apiVersion: string): void {
    this.projects = projectFixtures();
    this.templates = templateFixtures();
    this.plugins = pluginFixtures();
    this.entities = entityFixtures();
    this.queue = create(QueueSummarySchema, {
      queued: 2,
      preparing: 0,
      running: 1,
      gpusTotal: 4,
      gpusBusy: 1,
    });
    this.apiVersion = apiVersion;
    this.nextId = 1;
  }

  private newId(prefix: string): string {
    return `${prefix}-${this.nextId++}`;
  }

  project(id: string): Project | undefined {
    return this.projects.find((project) => project.id === id);
  }

  createProject(name: string, description: string, templateId: string) {
    const template = this.templates.find((t) => t.id === templateId);
    if (!template) return undefined;
    const now = timestampNow();
    const project = create(ProjectSchema, {
      id: this.newId("p"),
      name,
      description,
      concept: template.concept,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });
    this.projects.push(project);
    this.entities.push(...starterEntities(project.id));
    return project;
  }

  saveTemplate(projectId: string, name: string, description: string) {
    const project = this.project(projectId);
    if (!project) return undefined;
    const template = create(TemplateSchema, {
      id: this.newId("tpl"),
      name,
      description,
      kind: TemplateKind.SAVED,
      concept: project.concept,
    });
    this.templates.push(template);
    return template;
  }

  exportProject(projectId: string): string | undefined {
    const project = this.project(projectId);
    if (!project) return undefined;
    return JSON.stringify({
      format: EXPORT_FORMAT,
      buildId: MOCK_BUILD_ID,
      project: toJson(ProjectSchema, project),
    });
  }

  /** Validates a snapshot as the server's import would (D100, D139). */
  importProject(text: string): Omit<ImportProjectResponse, "$typeName"> {
    const error = (message: string) => ({
      issues: [
        create(ValidationIssueSchema, {
          severity: IssueSeverity.ERROR,
          path: "",
          message,
        }),
      ],
    });
    let snapshot: { format?: unknown; buildId?: unknown; project?: unknown };
    try {
      snapshot = JSON.parse(text) as typeof snapshot;
    } catch {
      return error("Not a Nebula project export");
    }
    if (snapshot.format !== EXPORT_FORMAT || !snapshot.project) {
      return error("Not a Nebula project export");
    }
    let imported: Project;
    try {
      imported = fromJson(ProjectSchema, snapshot.project as JsonValue);
    } catch (e) {
      return error(`Invalid project metadata: ${(e as Error).message}`);
    }
    const project = create(ProjectSchema, {
      ...imported,
      id: this.newId("p"),
      updatedAt: timestampNow(),
    });
    const issues = [];
    if (snapshot.buildId !== MOCK_BUILD_ID && project.runCount > 0) {
      project.nonReproducibleRunCount = project.runCount;
      issues.push(
        create(ValidationIssueSchema, {
          severity: IssueSeverity.WARNING,
          path: "runs",
          message: `Exported by build ${String(snapshot.buildId)}; its ${project.runCount} runs are viewable, not reproducible here.`,
        }),
      );
    }
    this.projects.push(project);
    return { project, issues };
  }

  entityRecords(projectId: string, kind: EntityKind): EntityRecord[] {
    return this.entities.filter(
      (record) => record.projectId === projectId && record.draft.kind === kind,
    );
  }

  entity(projectId: string, kind: EntityKind, id: string) {
    return this.entities.find(
      (record) =>
        record.projectId === projectId &&
        record.draft.kind === kind &&
        record.draft.id === id,
    );
  }

  summary(record: EntityRecord): EntitySummary {
    return create(EntitySummarySchema, {
      kind: record.draft.kind,
      id: record.draft.id,
      name: record.draft.name,
      revision: record.draft.revision,
      headHash: record.versions[0]?.hash ?? "",
      contentType: record.draft.content?.typeUrl.split("/").pop() ?? "",
    });
  }

  /** Conditional update (D148): applies only on the current revision. */
  updateDraft(
    record: EntityRecord,
    baseRevision: number,
    update: Pick<UpdateDraftRequest, "name" | "content">,
  ): DraftUpdateResult {
    if (baseRevision !== record.draft.revision) {
      return { ok: false, current: record.draft };
    }
    record.draft = {
      ...record.draft,
      name: update.name || record.draft.name,
      content: update.content ?? record.draft.content,
      revision: record.draft.revision + 1,
      updatedAt: timestampNow(),
    };
    this.publishEntity(record, ChangeType.DRAFT_UPDATED);
    return { ok: true, draft: record.draft };
  }

  publishEntity(record: EntityRecord, change: ChangeType): void {
    const event = create(EntityChangeSchema, {
      projectId: record.projectId,
      kind: record.draft.kind,
      id: record.draft.id,
      change,
      revision: record.draft.revision,
    });
    for (const listener of this.entityListeners) listener(event);
  }

  onEntityChange(listener: (change: EntityChange) => void): () => void {
    this.entityListeners.add(listener);
    return () => this.entityListeners.delete(listener);
  }

  setQueue(summary: QueueSummary): void {
    this.queue = summary;
    for (const listener of this.queueListeners) listener(summary);
  }

  onQueueChange(listener: (summary: QueueSummary) => void): () => void {
    this.queueListeners.add(listener);
    return () => this.queueListeners.delete(listener);
  }
}
