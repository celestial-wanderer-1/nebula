import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EntityDraftSchema, EntityKind } from "../gen/nebula/core/v1/entity_pb";
import {
  InstantiateWorkflowRequestSchema,
  ListWorkflowTemplatesResponseSchema,
  ValidateWorkflowRequestSchema,
  ValidateWorkflowResponseSchema,
} from "../gen/nebula/core/v1/workflow_pb";
import { apiJson, jsonBody } from "./client";
import { entityCollectionPath, entityPath, putDraftIfNewer } from "./entities";
import { queryKeys } from "./queryKeys";

/**
 * Templates a workflow can start from: the project concept's default
 * workflow and the standard chains (D50, D86).
 */
export function useWorkflowTemplates(projectId: string) {
  return useQuery({
    queryKey: queryKeys.workflowTemplates(projectId),
    queryFn: ({ signal }) =>
      apiJson(
        `/projects/${encodeURIComponent(projectId)}/workflow-templates`,
        ListWorkflowTemplatesResponseSchema,
        { signal },
      ),
    select: (response) => response.templates,
    staleTime: Infinity,
  });
}

/** Creates a workflow from a template; returns its first draft. */
export function useInstantiateWorkflow(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: { templateId: string; name: string }) =>
      apiJson(
        `${entityCollectionPath(projectId, EntityKind.WORKFLOW)}/instantiate`,
        EntityDraftSchema,
        {
          method: "POST",
          ...jsonBody(InstantiateWorkflowRequestSchema, request),
        },
      ),
    onSuccess: (draft) => {
      putDraftIfNewer(
        queryClient,
        queryKeys.draft(projectId, EntityKind.WORKFLOW, draft.id),
        draft,
      );
      return queryClient.invalidateQueries({
        queryKey: queryKeys.entities(projectId, EntityKind.WORKFLOW),
      });
    },
  });
}

/**
 * Asks the server to validate the workflow's saved draft (D64, D113, D114,
 * D116). The server is authoritative; client checks are only advisory.
 */
export function useValidateWorkflow(projectId: string, workflowId: string) {
  return useMutation({
    mutationFn: (gpus: number = 0) =>
      apiJson(
        `${entityPath(projectId, EntityKind.WORKFLOW, workflowId)}/validate`,
        ValidateWorkflowResponseSchema,
        {
          method: "POST",
          ...jsonBody(ValidateWorkflowRequestSchema, { gpus }),
        },
      ),
  });
}
