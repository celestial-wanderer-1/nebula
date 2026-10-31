import { http } from "msw";
import { DraftConflictSchema } from "../../gen/nebula/core/v1/errors_pb";
import {
  CreateEntityRequestSchema,
  EntityDraftSchema,
  EntityVersionSchema,
  ListEntitiesResponseSchema,
  ListVersionsResponseSchema,
  UpdateDraftRequestSchema,
} from "../../gen/nebula/core/v1/entity_pb";
import { store } from "../state";
import {
  apiError,
  created,
  entityKind,
  nameRequired,
  noContent,
  notFound,
  proto,
  readProto,
  reply,
} from "./util";

/**
 * Draft entities by collection segment (A§13.2): list, create, read, the
 * conditional update (D148), delete and versions. Registered last.
 */
export const entityHandlers = [
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

  http.post("/projects/:projectId/:segment", async ({ params, request }) => {
    const kind = entityKind(params.segment);
    if (kind === undefined) return notFound("Collection");
    const body = await readProto(CreateEntityRequestSchema, request);
    if (!body.name.trim()) return nameRequired();
    return reply(
      store.createEntity(
        String(params.projectId),
        kind,
        body.name.trim(),
        body.content,
      ),
      (record) => proto(EntityDraftSchema, record.draft, created),
    );
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

  http.delete("/projects/:projectId/:segment/:id", ({ params }) => {
    const kind = entityKind(params.segment);
    if (kind === undefined) return notFound("Entity");
    return reply(
      store.deleteEntity(String(params.projectId), kind, String(params.id)),
      noContent,
    );
  }),

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

  http.get("/projects/:projectId/:segment/:id/versions/:hash", ({ params }) => {
    const kind = entityKind(params.segment);
    const record =
      kind === undefined
        ? undefined
        : store.entity(String(params.projectId), kind, String(params.id));
    const version = record && store.entityVersion(record, String(params.hash));
    return version
      ? proto(EntityVersionSchema, version)
      : notFound(record ? "Version" : "Entity");
  }),
];
