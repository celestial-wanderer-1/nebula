import { http } from "msw";
import {
  InputDatasetSchema,
  ListInputDatasetsResponseSchema,
} from "../../gen/nebula/core/v1/dataset_pb";
import { EntityDraftSchema } from "../../gen/nebula/core/v1/entity_pb";
import { ListRunOutputsResponseSchema } from "../../gen/nebula/core/v1/output_pb";
import { ListRunsResponseSchema } from "../../gen/nebula/core/v1/run_pb";
import {
  InstantiateWorkflowRequestSchema,
  ListWorkflowTemplatesResponseSchema,
  ValidateWorkflowRequestSchema,
  ValidateWorkflowResponseSchema,
} from "../../gen/nebula/core/v1/workflow_pb";
import { store } from "../state";
import { created, notFound, proto, readProto, reply } from "./util";

/**
 * Setup and run resources (docs/UI.md 6.4, 6.5): workflow templates and
 * validation, input datasets, and Runs with their committed outputs.
 * Registered before the generic entity handlers.
 */
export const setupHandlers = [
  http.get("/projects/:projectId/workflow-templates", ({ params }) => {
    const projectId = String(params.projectId);
    if (!store.project(projectId)) return notFound("Project");
    return proto(ListWorkflowTemplatesResponseSchema, {
      templates: store.templatesFor(projectId),
    });
  }),

  http.post(
    "/projects/:projectId/workflows/instantiate",
    async ({ params, request }) => {
      const body = await readProto(InstantiateWorkflowRequestSchema, request);
      return reply(
        store.instantiateWorkflow(
          String(params.projectId),
          body.templateId,
          body.name.trim(),
        ),
        (record) => proto(EntityDraftSchema, record.draft, created),
      );
    },
  ),

  http.post(
    "/projects/:projectId/workflows/:workflowId/validate",
    async ({ params, request }) => {
      const body = await readProto(ValidateWorkflowRequestSchema, request);
      return reply(
        store.validateWorkflow(
          String(params.projectId),
          String(params.workflowId),
          body.gpus,
        ),
        (issues) => proto(ValidateWorkflowResponseSchema, { issues }),
      );
    },
  ),

  http.get("/projects/:projectId/inputs", ({ params }) => {
    const projectId = String(params.projectId);
    if (!store.project(projectId)) return notFound("Project");
    return proto(ListInputDatasetsResponseSchema, {
      datasets: store.inputList(projectId),
    });
  }),

  http.post("/projects/:projectId/inputs", async ({ params, request }) => {
    const query = new URL(request.url).searchParams;
    return reply(
      store.uploadInput(
        String(params.projectId),
        query.get("name") ?? "",
        query.get("sub_contract") ?? "",
        new Uint8Array(await request.arrayBuffer()),
      ),
      (dataset) => proto(InputDatasetSchema, dataset, created),
    );
  }),

  http.get("/projects/:projectId/runs", ({ params }) => {
    const projectId = String(params.projectId);
    if (!store.project(projectId)) return notFound("Project");
    return proto(ListRunsResponseSchema, { runs: store.runList(projectId) });
  }),

  http.get("/projects/:projectId/runs/:runId/outputs", ({ params }) => {
    const run = store.run(String(params.projectId), String(params.runId));
    return run
      ? proto(ListRunOutputsResponseSchema, {
          outputs: store.runOutputs(run.id),
        })
      : notFound("Run");
  }),
];
