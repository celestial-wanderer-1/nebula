import { http, HttpResponse } from "msw";
import { ListRunOutputsResponseSchema } from "../../gen/nebula/core/v1/output_pb";
import {
  ListQueueResponseSchema,
  ReorderQueueRequestSchema,
} from "../../gen/nebula/core/v1/queue_pb";
import {
  ListRunsResponseSchema,
  RerunRequestSchema,
  RunAction,
  RunActionRequestSchema,
  RunSchema,
  SubmitRunRequestSchema,
  SubmitRunResponseSchema,
} from "../../gen/nebula/core/v1/run_pb";
import { rerun, submitRun } from "../runs/service";
import { store } from "../state";
import { apiError, created, notFound, proto, readProto, reply } from "./util";

/**
 * Runs and the queue (A§13.2, A§14.1): submission, actions, re-runs and
 * outputs per project; the shared FIFO queue with reorder and cancel.
 */
export const runHandlers = [
  http.get("/projects/:projectId/runs", ({ params }) => {
    const projectId = String(params.projectId);
    if (!store.project(projectId)) return notFound("Project");
    return proto(ListRunsResponseSchema, { runs: store.runList(projectId) });
  }),

  http.post("/projects/:projectId/runs", async ({ params, request }) => {
    const body = await readProto(SubmitRunRequestSchema, request);
    return reply(submitRun(store, String(params.projectId), body), (response) =>
      proto(
        SubmitRunResponseSchema,
        response,
        response.run ? created : undefined,
      ),
    );
  }),

  http.get("/projects/:projectId/runs/:runId", ({ params }) => {
    const run = store.run(String(params.projectId), String(params.runId));
    return run ? proto(RunSchema, run) : notFound("Run");
  }),

  http.post(
    "/projects/:projectId/runs/:runId/actions",
    async ({ params, request }) => {
      const run = store.run(String(params.projectId), String(params.runId));
      if (!run) return notFound("Run");
      const body = await readProto(RunActionRequestSchema, request);
      const result = store.engine.action(run.id, body.action);
      return result.ok
        ? proto(RunSchema, result.run)
        : apiError(409, "invalid_state", result.message);
    },
  ),

  http.post(
    "/projects/:projectId/runs/:runId/rerun",
    async ({ params, request }) => {
      const body = await readProto(RerunRequestSchema, request);
      return reply(
        rerun(store, String(params.projectId), String(params.runId), body),
        (run) => proto(RunSchema, run, created),
      );
    },
  ),

  http.get("/projects/:projectId/runs/:runId/outputs", ({ params }) => {
    const run = store.run(String(params.projectId), String(params.runId));
    return run
      ? proto(ListRunOutputsResponseSchema, {
          outputs: store.runOutputs(run.id),
        })
      : notFound("Run");
  }),

  http.get("/queue", () =>
    proto(ListQueueResponseSchema, {
      entries: store.engine.entries(),
      summary: store.queue,
    }),
  ),

  http.post("/queue/reorder", async ({ request }) => {
    const body = await readProto(ReorderQueueRequestSchema, request);
    return store.engine.reorder(body.runId, body.position)
      ? new HttpResponse(null, { status: 204 })
      : apiError(409, "invalid_state", "Only waiting runs can be reordered");
  }),

  http.post("/queue/:runId/cancel", ({ params }) => {
    const result = store.engine.action(String(params.runId), RunAction.CANCEL);
    return result.ok
      ? proto(RunSchema, result.run)
      : apiError(409, "invalid_state", result.message);
  }),
];
