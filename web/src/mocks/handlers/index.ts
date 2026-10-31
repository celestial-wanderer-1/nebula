import { http, HttpResponse } from "msw";
import { EntityDraftSchema } from "../../gen/nebula/core/v1/entity_pb";
import { GeometryTessellationSchema } from "../../gen/nebula/core/v1/geometry_pb";
import {
  AddToLibraryRequestSchema,
  ImportFromLibraryRequestSchema,
  LibraryComponentSchema,
  LibraryMaterialSchema,
  ListLibraryComponentsResponseSchema,
  ListLibraryMaterialsResponseSchema,
} from "../../gen/nebula/core/v1/library_pb";
import {
  ListMaterialsResponseSchema,
  MaterialRequestSchema,
  MaterialSchema,
} from "../../gen/nebula/core/v1/material_pb";
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
import { downloadName } from "../store";
import { store } from "../state";
import { MOCK_BUILD_ID } from "../token";
import { entityHandlers } from "./entities";
import { setupHandlers } from "./setup";
import {
  apiError,
  created,
  nameRequired,
  noContent,
  notFound,
  proto,
  readProto,
  reply,
  unauthorized,
} from "./util";

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
    if (!body.name.trim()) return nameRequired();
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
    const name = downloadName(store.project(id)?.name ?? id);
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

  // User-global library (D88).

  http.get("/library/components", () =>
    proto(ListLibraryComponentsResponseSchema, {
      components: store.library.components,
    }),
  ),

  http.get("/library/components/:entryId", ({ params }) => {
    const entry = store.library.components.find((c) => c.id === params.entryId);
    return entry
      ? proto(LibraryComponentSchema, entry)
      : notFound("Library component");
  }),

  http.post("/library/components", async ({ request }) => {
    const body = await readProto(AddToLibraryRequestSchema, request);
    return reply(
      store.addComponentToLibrary(
        body.projectId,
        body.itemId,
        body.description,
      ),
      (entry) => proto(LibraryComponentSchema, entry, created),
    );
  }),

  http.get("/library/materials", () =>
    proto(ListLibraryMaterialsResponseSchema, {
      materials: store.library.materials,
    }),
  ),

  http.get("/library/materials/:entryId", ({ params }) => {
    const entry = store.library.materials.find((m) => m.id === params.entryId);
    return entry
      ? proto(LibraryMaterialSchema, entry)
      : notFound("Library material");
  }),

  http.post("/library/materials", async ({ request }) => {
    const body = await readProto(AddToLibraryRequestSchema, request);
    return reply(
      store.addMaterialToLibrary(body.projectId, body.itemId, body.description),
      (entry) => proto(LibraryMaterialSchema, entry, created),
    );
  }),

  // Project materials and imports: before the generic entity handlers, whose
  // :segment and :id would otherwise match them.

  http.get("/projects/:projectId/materials", ({ params }) => {
    const projectId = String(params.projectId);
    if (!store.project(projectId)) return notFound("Project");
    return proto(ListMaterialsResponseSchema, {
      materials: store.materialList(projectId),
    });
  }),

  http.post(
    "/projects/:projectId/materials/import",
    async ({ params, request }) => {
      const body = await readProto(ImportFromLibraryRequestSchema, request);
      return reply(
        store.importMaterial(String(params.projectId), body.entryId),
        (material) => proto(MaterialSchema, material, created),
      );
    },
  ),

  http.post("/projects/:projectId/materials", async ({ params, request }) => {
    const body = await readProto(MaterialRequestSchema, request);
    if (!body.name.trim()) return nameRequired();
    return reply(
      store.createMaterial(String(params.projectId), {
        ...body,
        name: body.name.trim(),
      }),
      (material) => proto(MaterialSchema, material, created),
    );
  }),

  http.get("/projects/:projectId/materials/:materialId", ({ params }) => {
    const material = store.material(
      String(params.projectId),
      String(params.materialId),
    );
    return material ? proto(MaterialSchema, material) : notFound("Material");
  }),

  http.put(
    "/projects/:projectId/materials/:materialId",
    async ({ params, request }) => {
      const body = await readProto(MaterialRequestSchema, request);
      if (!body.name.trim()) return nameRequired();
      return reply(
        store.updateMaterial(
          String(params.projectId),
          String(params.materialId),
          { ...body, name: body.name.trim() },
        ),
        (material) => proto(MaterialSchema, material),
      );
    },
  ),

  http.delete("/projects/:projectId/materials/:materialId", ({ params }) =>
    reply(
      store.deleteMaterial(String(params.projectId), String(params.materialId)),
      noContent,
    ),
  ),

  http.post(
    "/projects/:projectId/components/import",
    async ({ params, request }) => {
      const body = await readProto(ImportFromLibraryRequestSchema, request);
      return reply(
        store.importComponent(String(params.projectId), body.entryId),
        (record) => proto(EntityDraftSchema, record.draft, created),
      );
    },
  ),

  // Geometry worker outputs (A§3.3, D27).

  http.get(
    "/projects/:projectId/geometries/:geometryId/tessellation",
    ({ params, request }) => {
      const query = new URL(request.url).searchParams;
      const version = query.get("version") ?? undefined;
      const tessellation = store.tessellation(
        String(params.projectId),
        String(params.geometryId),
        query.get("component") ?? undefined,
        version,
      );
      return tessellation
        ? proto(GeometryTessellationSchema, tessellation)
        : notFound(version ? "Version" : "Geometry");
    },
  ),

  http.get(
    "/projects/:projectId/geometries/:geometryId/step",
    ({ params, request }) => {
      const version =
        new URL(request.url).searchParams.get("version") ?? undefined;
      const step = store.step(
        String(params.projectId),
        String(params.geometryId),
        version,
      );
      if (!step) return notFound(version ? "Version" : "Geometry");
      return new HttpResponse(step.body, {
        headers: {
          "Content-Type": "application/step",
          "Content-Disposition": `attachment; filename="${step.filename}"`,
        },
      });
    },
  ),

  ...setupHandlers,

  // Generic entity collections last: their :segment and :id match anything.
  ...entityHandlers,
];
