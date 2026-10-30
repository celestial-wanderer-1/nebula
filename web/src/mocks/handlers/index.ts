import { http, HttpResponse } from "msw";
import {
  ApiErrorSchema,
  DraftConflictSchema,
} from "../../gen/nebula/core/v1/errors_pb";
import {
  EntityDraftSchema,
  EntityKind,
  ListEntitiesResponseSchema,
  ListVersionsResponseSchema,
  UpdateDraftRequestSchema,
} from "../../gen/nebula/core/v1/entity_pb";
import { ListPluginsResponseSchema } from "../../gen/nebula/core/v1/plugin_pb";
import {
  CreateProjectRequestSchema,
  ImportProjectResponseSchema,
  ListProjectsResponseSchema,
  ListTemplatesResponseSchema,
  ProjectSchema,
  SaveTemplateRequestSchema,
  TemplateSchema,
} from "../../gen/nebula/core/v1/project_pb";
import { VersionInfoSchema } from "../../gen/nebula/core/v1/version_pb";
import { ENTITY_SEGMENTS } from "../../api/entities";
import { store } from "../state";
import { MOCK_BUILD_ID } from "../token";
import { apiError, notFound, proto, readProto, unauthorized } from "./util";

const kindBySegment = new Map(
  Object.entries(ENTITY_SEGMENTS)
    .filter(([, segment]) => segment)
    .map(([kind, segment]) => [segment, Number(kind) as EntityKind]),
);

function entityKind(segment: unknown): EntityKind | undefined {
  return typeof segment === "string" ? kindBySegment.get(segment) : undefined;
}

// Paths the server owns; anything else (the bundle, assets) passes through.
const API_PATH =
  /^\/(version|projects|templates|plugins|queue|settings|library)(\/|$)/;

export const restHandlers = [
  http.all("*", ({ request }) => {
    const url = new URL(request.url);
    if (url.origin !== location.origin || !API_PATH.test(url.pathname)) return;
    return unauthorized(request);
  }),

  http.get("/version", () =>
    proto(VersionInfoSchema, {
      apiVersion: store.apiVersion,
      buildId: MOCK_BUILD_ID,
      serverVersion: "0.0.0-mock",
    }),
  ),

  http.get("/plugins", () =>
    proto(ListPluginsResponseSchema, { plugins: store.plugins }),
  ),

  http.get("/templates", () =>
    proto(ListTemplatesResponseSchema, { templates: store.templates }),
  ),

  http.get("/projects", () =>
    proto(ListProjectsResponseSchema, { projects: store.projects }),
  ),

  http.post("/projects", async ({ request }) => {
    const body = await readProto(CreateProjectRequestSchema, request);
    if (!body.name.trim()) {
      return proto(
        ApiErrorSchema,
        {
          code: "invalid",
          message: "Validation failed",
          violations: [{ path: "name", message: "A name is required" }],
        },
        { status: 422 },
      );
    }
    const project = store.createProject(
      body.name.trim(),
      body.description,
      body.templateId,
    );
    return project
      ? proto(ProjectSchema, project, { status: 201 })
      : apiError(422, "invalid", `Unknown template ${body.templateId}`);
  }),

  http.post("/projects/import", async ({ request }) =>
    proto(
      ImportProjectResponseSchema,
      store.importProject(await request.text()),
    ),
  ),

  http.get("/projects/:projectId", ({ params }) => {
    const project = store.project(String(params.projectId));
    return project ? proto(ProjectSchema, project) : notFound("Project");
  }),

  http.get("/projects/:projectId/export", ({ params }) => {
    const id = String(params.projectId);
    const snapshot = store.exportProject(id);
    if (snapshot === undefined) return notFound("Project");
    const name = store.project(id)?.name.replace(/[^\w.-]+/g, "-") ?? id;
    return new HttpResponse(snapshot, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}.nebula"`,
      },
    });
  }),

  http.post("/projects/:projectId/template", async ({ params, request }) => {
    const body = await readProto(SaveTemplateRequestSchema, request);
    const template = store.saveTemplate(
      String(params.projectId),
      body.name,
      body.description,
    );
    return template
      ? proto(TemplateSchema, template, { status: 201 })
      : notFound("Project");
  }),

  http.get("/projects/:projectId/:segment", ({ params }) => {
    const kind = entityKind(params.segment);
    const projectId = String(params.projectId);
    if (kind === undefined || !store.project(projectId)) {
      return notFound("Collection");
    }
    return proto(ListEntitiesResponseSchema, {
      entities: store
        .entityRecords(projectId, kind)
        .map((record) => store.summary(record)),
    });
  }),

  http.get("/projects/:projectId/:segment/:id", ({ params }) => {
    const kind = entityKind(params.segment);
    const record =
      kind === undefined
        ? undefined
        : store.entity(String(params.projectId), kind, String(params.id));
    return record ? proto(EntityDraftSchema, record.draft) : notFound("Entity");
  }),

  http.patch(
    "/projects/:projectId/:segment/:id",
    async ({ params, request }) => {
      const kind = entityKind(params.segment);
      const record =
        kind === undefined
          ? undefined
          : store.entity(String(params.projectId), kind, String(params.id));
      if (!record) return notFound("Entity");
      const ifMatch = /^"?(\d+)"?$/.exec(request.headers.get("If-Match") ?? "");
      if (!ifMatch) {
        return apiError(428, "precondition_required", "If-Match is required");
      }
      const body = await readProto(UpdateDraftRequestSchema, request);
      const result = store.updateDraft(record, Number(ifMatch[1]), body);
      return result.ok
        ? proto(EntityDraftSchema, result.draft)
        : proto(
            DraftConflictSchema,
            {
              message: "The draft was changed by another client",
              current: result.current,
            },
            { status: 409 },
          );
    },
  ),

  http.get("/projects/:projectId/:segment/:id/versions", ({ params }) => {
    const kind = entityKind(params.segment);
    const record =
      kind === undefined
        ? undefined
        : store.entity(String(params.projectId), kind, String(params.id));
    return record
      ? proto(ListVersionsResponseSchema, {
          versions: record.versions,
          headHash: record.versions[0]?.hash ?? "",
        })
      : notFound("Entity");
  }),
];
