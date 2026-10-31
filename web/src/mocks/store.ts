import {
  clone,
  create,
  equals,
  fromJson,
  toJson,
  type JsonValue,
} from "@bufbuild/protobuf";
import {
  anyPack,
  anyUnpack,
  timestampNow,
  type Any,
} from "@bufbuild/protobuf/wkt";
import { typeNameOf, unwrapComponent } from "../entities/content";
import { ComponentSchema } from "../gen/nebula/core/v1/component_pb";
import {
  ChangeType,
  EntityChangeSchema,
  EntityDraftSchema,
  EntityKind,
  EntityVersionSchema,
  type EntityRef,
  type EntityVersion,
  EntitySummarySchema,
  LibrarySourceSchema,
  type EntityChange,
  type EntityDraft,
  type EntitySummary,
  type UpdateDraftRequest,
} from "../gen/nebula/core/v1/entity_pb";
import {
  ComponentTessellationSchema,
  GeometrySchema,
  GeometryTessellationSchema,
  type ComponentTessellation,
  type Geometry,
  type GeometryTessellation,
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
  type MaterialRequest,
} from "../gen/nebula/core/v1/material_pb";
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
  InputDatasetSchema,
  type InputDataset,
} from "../gen/nebula/core/v1/dataset_pb";
import type { RunOutput } from "../gen/nebula/core/v1/output_pb";
import type { Run } from "../gen/nebula/core/v1/run_pb";
import {
  WorkflowSchema,
  type WorkflowTemplate,
} from "../gen/nebula/core/v1/workflow_pb";
import type { ValidationIssue } from "../gen/nebula/core/v1/project_pb";
import {
  entityFixtures,
  libraryFixtures,
  materialFixtures,
  mockSchema,
  pluginFixtures,
  projectFixtures,
  starterEntities,
  starterMaterials,
  templateFixtures,
  type EntityRecord,
  type LibraryState,
  type MaterialRecord,
} from "./fixtures";
import {
  inputFixtures,
  outputFixtures,
  runFixtures,
  workflowTemplateFixtures,
  type InputRecord,
} from "./setupFixtures";
import { conceptTraits } from "./extensions";
import { checkGeometry, tessellateShape } from "./tessellate";
import { validateWorkflow } from "./workflows/validate";
import { MOCK_BUILD_ID } from "./token";

const EXPORT_FORMAT = "nebula-mock-export/1";

// The 8-byte signature every HDF5 file starts with.
const HDF5_SIGNATURE = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];

export type DraftUpdateResult =
  { ok: true; draft: EntityDraft } | { ok: false; current: EntityDraft };

/** A store operation's value, or the API error the server would return. */
export type StoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string; message: string };

const ok = <T>(value: T): StoreResult<T> => ({ ok: true, value });
const fail = <T>(
  status: number,
  code: string,
  message: string,
): StoreResult<T> => ({ ok: false, status, code, message });
const notFound = <T>(what: string) =>
  fail<T>(404, "not_found", `${what} not found`);
const inUse = <T>(message: string) => fail<T>(409, "in_use", message);

const ID_PREFIX: Partial<Record<EntityKind, string>> = {
  [EntityKind.GEOMETRY]: "geo",
  [EntityKind.COMPONENT]: "cmp",
  [EntityKind.REGION]: "reg",
  [EntityKind.SCENARIO]: "scn",
  [EntityKind.CONDUCTOR_NETWORK]: "cn",
  [EntityKind.WORKFLOW]: "wf",
};

/** File name of a download, sanitised like the project export. */
export function downloadName(name: string): string {
  return name.replace(/[^\w.-]+/g, "-");
}

/** Shape a component reference resolves to, with its build identity. */
interface ResolvedComponent {
  record: EntityRecord;
  content?: Any;
  revision: number;
  versionHash: string;
  error?: string;
}

const geometryOf = (content: Any | undefined): Geometry =>
  (content && anyUnpack(content, GeometrySchema)) || create(GeometrySchema);

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
  materials: MaterialRecord[] = [];
  library: LibraryState = { components: [], materials: [] };
  queue: QueueSummary = create(QueueSummarySchema);
  runs: Run[] = [];
  outputs: RunOutput[] = [];
  inputs: InputRecord[] = [];
  workflowTemplates: WorkflowTemplate[] = [];
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
    this.materials = materialFixtures();
    this.library = libraryFixtures();
    this.runs = runFixtures();
    this.outputs = outputFixtures();
    this.inputs = inputFixtures();
    this.workflowTemplates = workflowTemplateFixtures();
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
    this.entities.push(
      ...starterEntities(project.id, template.concept?.conceptId ?? ""),
    );
    this.materials.push(...starterMaterials(project.id));
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

  /** POST /projects/{p}/{segment}: a new entity at revision 1. */
  createEntity(
    projectId: string,
    kind: EntityKind,
    name: string,
    content?: Any,
  ): StoreResult<EntityRecord> {
    if (!this.project(projectId)) return notFound("Project");
    const record: EntityRecord = {
      projectId,
      draft: create(EntityDraftSchema, {
        kind,
        id: this.newId(ID_PREFIX[kind] ?? "ent"),
        name,
        revision: 1,
        updatedAt: timestampNow(),
        content,
      }),
      versions: [],
    };
    this.entities.push(record);
    this.publishEntity(record, ChangeType.CREATED);
    return ok(record);
  }

  /** Refuses to delete a component a geometry draft references. */
  deleteEntity(
    projectId: string,
    kind: EntityKind,
    id: string,
  ): StoreResult<EntityRecord> {
    const record = this.entity(projectId, kind, id);
    if (!record) return notFound("Entity");
    if (kind === EntityKind.COMPONENT) {
      const user = this.entityRecords(projectId, EntityKind.GEOMETRY).find(
        (geometry) =>
          geometryOf(geometry.draft.content).components.some(
            (ref) => ref.id === id,
          ),
      );
      if (user) return inUse(`Referenced by geometry "${user.draft.name}"`);
    }
    this.entities = this.entities.filter((r) => r !== record);
    this.publishEntity(record, ChangeType.DELETED);
    return ok(record);
  }

  /** GET /projects/{p}/{kind}/{id}/versions/{hash}. */
  entityVersion(record: EntityRecord, hash: string): EntityVersion | undefined {
    const meta = record.versions.find((v) => v.hash === hash);
    if (!meta) return undefined;
    return create(EntityVersionSchema, {
      meta,
      content: record.versionContents?.[hash],
    });
  }

  /**
   * Content of any entity as a reference resolves it (D107): the draft, the
   * head version (`latest`) or a pinned version. Undefined when missing.
   */
  resolve(projectId: string, ref: EntityRef): Any | undefined {
    const record = this.entity(projectId, ref.kind, ref.id);
    if (!record) return undefined;
    switch (ref.state.case) {
      case "pinned":
        return record.versionContents?.[ref.state.value.versionHash];
      case "latest": {
        const head = record.versions[0]?.hash;
        return head ? record.versionContents?.[head] : undefined;
      }
      default:
        return record.draft.content;
    }
  }

  // Runs and outputs (A§13.2). P4 adds submission and the queue.

  runList(projectId: string): Run[] {
    return this.runs.filter((run) => run.projectId === projectId);
  }

  run(projectId: string, runId: string): Run | undefined {
    return this.runList(projectId).find((run) => run.id === runId);
  }

  runOutputs(runId: string): RunOutput[] {
    return this.outputs.filter((output) => output.runId === runId);
  }

  // Input datasets (D144).

  inputList(projectId: string): InputDataset[] {
    return this.inputs
      .filter((record) => record.projectId === projectId)
      .map((record) => record.dataset);
  }

  /**
   * Ingests an uploaded HDF5 file: checks the signature, hashes and
   * versions it (D144). The mock does not read the file's datasets.
   */
  uploadInput(
    projectId: string,
    name: string,
    subContract: string,
    bytes: Uint8Array,
  ): StoreResult<InputDataset> {
    if (!this.project(projectId)) return notFound("Project");
    if (!HDF5_SIGNATURE.every((byte, i) => bytes[i] === byte)) {
      return fail(422, "invalid", "Not an HDF5 file");
    }
    if (!subContract) {
      return fail(422, "invalid", "A sub-contract is required");
    }
    const id = this.newId("in");
    const hash = `sha256:${id}-${bytes.length}`;
    const dataset = create(InputDatasetSchema, {
      id,
      name: name || id,
      subContract,
      versionHash: hash,
      sizeBytes: BigInt(bytes.length),
      uploadedAt: timestampNow(),
      dataset: {
        owner: id,
        filePath: `inputs/${id}.h5`,
        datasetPath: "/",
        contentHash: hash,
      },
    });
    this.inputs.push({ projectId, dataset });
    return ok(dataset);
  }

  // Workflows (D50).

  /** Standard chains and the project concept's default workflow (D86). */
  templatesFor(projectId: string): WorkflowTemplate[] {
    const concept = this.project(projectId)?.concept?.conceptId ?? "";
    return this.workflowTemplates.filter(
      (t) => !t.conceptId || t.conceptId === concept,
    );
  }

  instantiateWorkflow(
    projectId: string,
    templateId: string,
    name: string,
  ): StoreResult<EntityRecord> {
    const template = this.templatesFor(projectId).find(
      (t) => t.id === templateId,
    );
    if (!template)
      return fail(422, "invalid", `Unknown template ${templateId}`);
    const workflow = clone(
      WorkflowSchema,
      template.workflow ?? create(WorkflowSchema),
    );
    workflow.templateId = templateId;
    return this.createEntity(
      projectId,
      EntityKind.WORKFLOW,
      name || template.name,
      anyPack(WorkflowSchema, workflow),
    );
  }

  /** POST /projects/{p}/workflows/{w}/validate on the draft. */
  validateWorkflow(
    projectId: string,
    workflowId: string,
    gpus: number,
  ): StoreResult<ValidationIssue[]> {
    const record = this.entity(projectId, EntityKind.WORKFLOW, workflowId);
    if (!record) return notFound("Workflow");
    const workflow =
      (record.draft.content &&
        anyUnpack(record.draft.content, WorkflowSchema)) ??
      create(WorkflowSchema);
    const concept = this.project(projectId)?.concept?.conceptId ?? "";
    return ok(
      validateWorkflow(
        workflow,
        {
          extensions: new Map(
            this.plugins.flatMap((p) => p.extensions.map((e) => [e.id, e])),
          ),
          conceptTraits: conceptTraits[concept] ?? [],
          resolve: (ref) => this.resolve(projectId, ref),
          shapeOf: (geometry, componentId) => {
            const ref = geometry.components.find((r) => r.id === componentId);
            const content = ref && this.resolve(projectId, ref);
            return content ? unwrapComponent(content).shape : undefined;
          },
          storedGeometries: (runId) => this.runGeometries(projectId, runId),
          registry: mockSchema.typeRegistry,
          gpusInstalled: this.queue.gpusTotal,
        },
        gpus,
      ),
    );
  }

  /** Geometries a Run's pinned workflow version was bound to. */
  private runGeometries(projectId: string, runId: string): Geometry[] {
    const run = this.run(projectId, runId);
    const record =
      run && this.entity(projectId, EntityKind.WORKFLOW, run.workflowId);
    const content = record?.versionContents?.[run?.workflowVersionHash ?? ""];
    const workflow = content && anyUnpack(content, WorkflowSchema);
    return (workflow?.nodes ?? []).flatMap((node) => {
      const step = node.kind.case === "solver" ? node.kind.value : undefined;
      const ref = step?.bindings.find((b) => b.port === "geometry")?.ref;
      const geometry = ref && this.resolve(projectId, ref);
      return geometry ? [geometryOf(geometry)] : [];
    });
  }

  // Materials (A§13.2): plain resources, last write wins.

  materialList(projectId: string): Material[] {
    return this.materials
      .filter((record) => record.projectId === projectId)
      .map((record) => record.material);
  }

  material(projectId: string, id: string): Material | undefined {
    return this.materials.find(
      (record) => record.projectId === projectId && record.material.id === id,
    )?.material;
  }

  createMaterial(
    projectId: string,
    request: Pick<MaterialRequest, "name" | "properties">,
  ): StoreResult<Material> {
    if (!this.project(projectId)) return notFound("Project");
    const material = create(MaterialSchema, {
      id: this.newId("m"),
      name: request.name,
      properties: request.properties,
    });
    this.materials.push({ projectId, material });
    return ok(material);
  }

  updateMaterial(
    projectId: string,
    id: string,
    request: Pick<MaterialRequest, "name" | "properties">,
  ): StoreResult<Material> {
    const record = this.materials.find(
      (r) => r.projectId === projectId && r.material.id === id,
    );
    if (!record) return notFound("Material");
    record.material = create(MaterialSchema, {
      ...record.material,
      name: request.name,
      properties: request.properties,
    });
    return ok(record.material);
  }

  /** Refuses to delete a material a component draft references. */
  deleteMaterial(projectId: string, id: string): StoreResult<Material> {
    const material = this.material(projectId, id);
    if (!material) return notFound("Material");
    const user = this.entityRecords(projectId, EntityKind.COMPONENT).find(
      (record) => unwrapComponent(record.draft.content).materialId === id,
    );
    if (user) return inUse(`Referenced by component "${user.draft.name}"`);
    this.materials = this.materials.filter(
      (r) => !(r.projectId === projectId && r.material.id === id),
    );
    return ok(material);
  }

  // Library (D88): imports copy with a provenance link.

  importMaterial(projectId: string, entryId: string): StoreResult<Material> {
    if (!this.project(projectId)) return notFound("Project");
    const entry = this.library.materials.find((m) => m.id === entryId);
    if (!entry) return notFound("Library material");
    const material = create(MaterialSchema, {
      id: this.newId("m"),
      name: entry.name,
      properties: entry.properties,
      source: { entryId, entryName: entry.name, importedAt: timestampNow() },
    });
    this.materials.push({ projectId, material });
    return ok(material);
  }

  /**
   * Copies a library component into the project. Its material comes along
   * unless the project already holds a copy of that library entry.
   */
  importComponent(
    projectId: string,
    entryId: string,
  ): StoreResult<EntityRecord> {
    if (!this.project(projectId)) return notFound("Project");
    const entry = this.library.components.find((c) => c.id === entryId);
    if (!entry) return notFound("Library component");
    let materialId = "";
    const libraryMaterial = entry.component?.materialId;
    if (libraryMaterial) {
      const held = this.materialList(projectId).find(
        (m) => m.source?.entryId === libraryMaterial,
      );
      if (held) {
        materialId = held.id;
      } else {
        const imported = this.importMaterial(projectId, libraryMaterial);
        if (imported.ok) materialId = imported.value.id;
      }
    }
    const content = anyPack(
      ComponentSchema,
      create(ComponentSchema, {
        shape: entry.component?.shape,
        materialId,
        source: create(LibrarySourceSchema, {
          entryId,
          entryName: entry.name,
          importedAt: timestampNow(),
        }),
      }),
    );
    return this.createEntity(
      projectId,
      EntityKind.COMPONENT,
      entry.name,
      content,
    );
  }

  addMaterialToLibrary(
    projectId: string,
    materialId: string,
    description: string,
  ): StoreResult<LibraryMaterial> {
    const material = this.material(projectId, materialId);
    if (!material) return notFound("Material");
    const entry = create(LibraryMaterialSchema, {
      id: this.newId("lib-mat"),
      name: material.name,
      description,
      properties: material.properties,
    });
    this.library.materials.push(entry);
    return ok(entry);
  }

  /**
   * Copies a project component into the library. Its material maps to the
   * library entry it came from while it still equals that entry (materials
   * are last-write-wins, D127), else is added to the library too.
   */
  addComponentToLibrary(
    projectId: string,
    componentId: string,
    description: string,
  ): StoreResult<LibraryComponent> {
    const record = this.entity(projectId, EntityKind.COMPONENT, componentId);
    if (!record) return notFound("Component");
    const component = unwrapComponent(record.draft.content);
    let materialId = "";
    const material = this.material(projectId, component.materialId);
    if (material) {
      const source = this.library.materials.find(
        (m) => m.id === material.source?.entryId,
      );
      if (source && sameMaterial(material, source)) {
        materialId = source.id;
      } else {
        const added = this.addMaterialToLibrary(projectId, material.id, "");
        if (added.ok) materialId = added.value.id;
      }
    }
    const entry = create(LibraryComponentSchema, {
      id: this.newId("lib-cmp"),
      name: record.draft.name,
      description,
      component: { shape: component.shape, materialId },
    });
    this.library.components.push(entry);
    return ok(entry);
  }

  // Geometry worker stand-ins (A§3.3).

  /** Resolves a geometry's component reference per its state (D107). */
  private resolveReference(
    projectId: string,
    geometry: Geometry,
    componentId: string,
  ): ResolvedComponent | undefined {
    const ref = geometry.components.find((r) => r.id === componentId);
    const record =
      ref && this.entity(projectId, EntityKind.COMPONENT, componentId);
    if (!ref || !record) return undefined;
    const fromVersion = (hash: string): ResolvedComponent => {
      const content = record.versionContents?.[hash];
      return content
        ? { record, content, revision: 0, versionHash: hash }
        : {
            record,
            revision: 0,
            versionHash: hash,
            error: `Version ${hash} not found`,
          };
    };
    switch (ref.state.case) {
      case "pinned":
        return fromVersion(ref.state.value.versionHash);
      case "latest": {
        const head = record.versions[0]?.hash;
        return head
          ? fromVersion(head)
          : {
              record,
              revision: 0,
              versionHash: "",
              error: "The component has no version yet",
            };
      }
      default:
        return {
          record,
          content: record.draft.content,
          revision: record.draft.revision,
          versionHash: "",
        };
    }
  }

  /** GET /projects/{p}/geometries/{g}/tessellation[?component=]. */
  tessellation(
    projectId: string,
    geometryId: string,
    componentId?: string,
    version?: string,
  ): GeometryTessellation | undefined {
    const record = this.entity(projectId, EntityKind.GEOMETRY, geometryId);
    if (!record) return undefined;
    if (version && !record.versions.some((v) => v.hash === version)) {
      return undefined;
    }
    const registry = mockSchema.typeRegistry;
    const geometry = geometryOf(
      version ? record.versionContents?.[version] : record.draft.content,
    );
    const shapeOf = (id: string) => {
      const resolved = this.resolveReference(projectId, geometry, id);
      return resolved?.content
        ? unwrapComponent(resolved.content).shape
        : undefined;
    };
    const components = geometry.components
      .filter((ref) => !componentId || ref.id === componentId)
      .map((ref): ComponentTessellation => {
        const resolved = this.resolveReference(projectId, geometry, ref.id);
        const base = {
          componentId: ref.id,
          revision: resolved?.revision ?? 0,
          versionHash: resolved?.versionHash ?? "",
        };
        if (!resolved) {
          return create(ComponentTessellationSchema, {
            ...base,
            error: "Component not found",
          });
        }
        if (resolved.error) {
          return create(ComponentTessellationSchema, {
            ...base,
            error: resolved.error,
          });
        }
        const built = tessellateShape(
          unwrapComponent(resolved.content).shape,
          registry,
        );
        return create(ComponentTessellationSchema, {
          ...base,
          ...("mesh" in built ? { mesh: built.mesh } : { error: built.error }),
        });
      });
    return create(GeometryTessellationSchema, {
      components,
      issues: checkGeometry(geometry, shapeOf, registry),
    });
  }

  /**
   * GET /projects/{p}/geometries/{g}/step[?version=] (D27): an
   * ISO-10303-21 file listing the geometry's components. Undefined for an
   * unknown geometry or version.
   */
  step(
    projectId: string,
    geometryId: string,
    version?: string,
  ): { filename: string; body: string } | undefined {
    const record = this.entity(projectId, EntityKind.GEOMETRY, geometryId);
    if (!record) return undefined;
    let content = record.draft.content;
    let filename = downloadName(record.draft.name);
    if (version) {
      if (!record.versions.some((v) => v.hash === version)) return undefined;
      content = record.versionContents?.[version] ?? content;
      const digest = version.slice(version.indexOf(":") + 1).slice(0, 10);
      filename = `${filename}-${downloadName(digest)}`;
    }
    filename = `${filename}.step`;
    const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;
    const geometry = geometryOf(content);
    const products = geometry.components.map((ref, i) => {
      const component = this.entity(projectId, EntityKind.COMPONENT, ref.id);
      const shape = typeNameOf(unwrapComponent(component?.draft.content).shape);
      return `#${i + 1}=PRODUCT(${quote(ref.id)},${quote(component?.draft.name ?? ref.id)},${quote(shape)},());`;
    });
    const body = [
      "ISO-10303-21;",
      "HEADER;",
      "FILE_DESCRIPTION(('Nebula geometry export (mock)'),'2;1');",
      `FILE_NAME(${quote(filename)},${quote(new Date().toISOString())},('Nebula'),(''),'nebula-mock','nebula-mock','');`,
      "FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));",
      "ENDSEC;",
      "DATA;",
      ...products,
      "ENDSEC;",
      "END-ISO-10303-21;",
      "",
    ].join("\n");
    return { filename, body };
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

/** Whether a project material still equals a library material. */
function sameMaterial(material: Material, entry: LibraryMaterial): boolean {
  const empty = create(MaterialPropertiesSchema);
  return (
    material.name === entry.name &&
    equals(
      MaterialPropertiesSchema,
      material.properties ?? empty,
      entry.properties ?? empty,
    )
  );
}
