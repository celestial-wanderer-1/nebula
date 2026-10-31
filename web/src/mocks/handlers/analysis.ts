import { http } from "msw";
import {
  ComparisonSchema,
  CreateComparisonRequestSchema,
  ListComparisonsResponseSchema,
} from "../../gen/nebula/core/v1/comparison_pb";
import {
  ProjectSchema,
  ProjectSettingsSchema,
} from "../../gen/nebula/core/v1/project_pb";
import { SettingsSchema } from "../../gen/nebula/core/v1/settings_pb";
import {
  DeleteResultsRequestSchema,
  DeleteResultsResponseSchema,
  DependentsResponseSchema,
  EvictRequestSchema,
  EvictResponseSchema,
  StorageUsageSchema,
} from "../../gen/nebula/core/v1/storage_pb";
import {
  CreateStudyRequestSchema,
  ListStudiesResponseSchema,
  StudySchema,
} from "../../gen/nebula/core/v1/study_pb";
import { store } from "../state";
import { created, notFound, proto, readProto, reply } from "./util";

/**
 * Comparisons, scan Studies, storage and settings (docs/UI.md 6.8 to 6.10).
 * Registered before the generic entity handlers.
 */
export const analysisHandlers = [
  http.get("/projects/:projectId/comparisons", ({ params }) =>
    proto(ListComparisonsResponseSchema, {
      comparisons: store.comparisons.list(String(params.projectId)),
    }),
  ),

  http.post("/projects/:projectId/comparisons", async ({ params, request }) => {
    const body = await readProto(CreateComparisonRequestSchema, request);
    return reply(
      store.comparisons.create(String(params.projectId), body),
      (c) => proto(ComparisonSchema, c, created),
    );
  }),

  http.get("/projects/:projectId/comparisons/:comparisonId", ({ params }) => {
    const comparison = store.comparisons.get(
      String(params.projectId),
      String(params.comparisonId),
    );
    return comparison
      ? proto(ComparisonSchema, comparison)
      : notFound("Comparison");
  }),

  http.get("/projects/:projectId/studies", ({ params }) =>
    proto(ListStudiesResponseSchema, {
      studies: store.studies.list(String(params.projectId)),
    }),
  ),

  http.post("/projects/:projectId/studies", async ({ params, request }) => {
    const body = await readProto(CreateStudyRequestSchema, request);
    return reply(
      store.studies.create(String(params.projectId), body),
      (study) => proto(StudySchema, study, created),
    );
  }),

  http.get("/projects/:projectId/studies/:studyId", ({ params }) => {
    const study = store.studies.get(
      String(params.projectId),
      String(params.studyId),
    );
    return study ? proto(StudySchema, study) : notFound("Study");
  }),

  http.post("/projects/:projectId/studies/:studyId/start", ({ params }) =>
    reply(
      store.studies.start(String(params.projectId), String(params.studyId)),
      (study) => proto(StudySchema, study),
    ),
  ),

  http.post("/projects/:projectId/studies/:studyId/stop", ({ params }) =>
    reply(
      store.studies.stop(String(params.projectId), String(params.studyId)),
      (study) => proto(StudySchema, study),
    ),
  ),

  http.get("/projects/:projectId/storage", ({ params }) => {
    const usage = store.storage.usage(String(params.projectId));
    return usage ? proto(StorageUsageSchema, usage) : notFound("Project");
  }),

  http.post(
    "/projects/:projectId/storage/evict",
    async ({ params, request }) => {
      const projectId = String(params.projectId);
      const body = await readProto(EvictRequestSchema, request);
      return reply(store.storage.evict(projectId, body.classes), (freedBytes) =>
        proto(EvictResponseSchema, {
          freedBytes,
          usage: store.storage.usage(projectId),
        }),
      );
    },
  ),

  http.get("/projects/:projectId/storage/dependents", ({ params, request }) => {
    const runId = new URL(request.url).searchParams.get("run") ?? "";
    return proto(DependentsResponseSchema, {
      dependents: store.storage.dependents(String(params.projectId), runId),
    });
  }),

  http.post(
    "/projects/:projectId/storage/delete",
    async ({ params, request }) => {
      const projectId = String(params.projectId);
      const body = await readProto(DeleteResultsRequestSchema, request);
      return reply(
        store.storage.deleteResults(
          projectId,
          body.runIds,
          body.acknowledgeDependents,
        ),
        (deleted) =>
          proto(DeleteResultsResponseSchema, {
            deleted,
            usage: store.storage.usage(projectId),
          }),
      );
    },
  ),

  http.put("/projects/:projectId/settings", async ({ params, request }) => {
    const body = await readProto(ProjectSettingsSchema, request);
    return reply(
      store.updateProjectSettings(String(params.projectId), body),
      (project) => proto(ProjectSchema, project),
    );
  }),

  http.get("/settings", () =>
    proto(SettingsSchema, {
      configPath: "~/.nebula/nebula.toml",
      toml: store.settingsToml,
    }),
  ),
];
