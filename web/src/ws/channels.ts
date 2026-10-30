import {
  useQuery,
  useQueryClient,
  skipToken,
  type QueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "../api/queryKeys";
import {
  ChangeType,
  EntityChangeSchema,
  type EntityChange,
  type EntityDraft,
} from "../gen/nebula/core/v1/entity_pb";
import {
  QueueEventSchema,
  type QueueSummary,
} from "../gen/nebula/core/v1/queue_pb";
import {
  TelemetryEventSchema,
  type TelemetryEvent,
} from "../gen/nebula/core/v1/telemetry_pb";
import { useChannel } from "./context";

export const entityChannelPath = (projectId: string) =>
  `/ws/projects/${encodeURIComponent(projectId)}/entities`;
export const QUEUE_CHANNEL = "/ws/queue";
export const TELEMETRY_CHANNEL = "/ws/telemetry";

/**
 * Applies an entity-change event to the query cache. A draft is refetched
 * only when the event's revision is newer than the cached one, so a client's
 * own saves, already in the cache, cause no refetch (D148).
 */
export function applyEntityChange(
  queryClient: QueryClient,
  change: EntityChange,
): void {
  const { projectId, kind, id } = change;
  const listKey = queryKeys.entities(projectId, kind);
  const draftKey = queryKeys.draft(projectId, kind, id);
  switch (change.change) {
    case ChangeType.DRAFT_UPDATED: {
      const held = queryClient.getQueryData<EntityDraft>(draftKey);
      if (!held || change.revision > held.revision) {
        void queryClient.invalidateQueries({ queryKey: draftKey });
        void queryClient.invalidateQueries({ queryKey: listKey });
      }
      break;
    }
    case ChangeType.VERSION_MINTED:
      void queryClient.invalidateQueries({
        queryKey: queryKeys.versions(projectId, kind, id),
      });
      void queryClient.invalidateQueries({ queryKey: listKey });
      break;
    case ChangeType.CREATED:
      void queryClient.invalidateQueries({ queryKey: listKey });
      break;
    case ChangeType.DELETED:
      queryClient.removeQueries({
        queryKey: queryKeys.entity(projectId, kind, id),
      });
      void queryClient.invalidateQueries({ queryKey: listKey });
      break;
    default:
      break;
  }
}

/** Keeps the project's entity channel open while the project is open. */
export function useEntityChannel(projectId: string | undefined): void {
  const queryClient = useQueryClient();
  useChannel(
    projectId ? entityChannelPath(projectId) : undefined,
    EntityChangeSchema,
    (change) => applyEntityChange(queryClient, change),
    // Events missed while disconnected are not replayed: refetch the project.
    () => {
      if (projectId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.project(projectId),
        });
      }
    },
  );
}

/** Subscribes to queue counts; state events overwrite the cache (D106). */
export function useQueueSummary(): QueueSummary | undefined {
  const queryClient = useQueryClient();
  useChannel(QUEUE_CHANNEL, QueueEventSchema, (event) => {
    if (event.event.case === "summary") {
      queryClient.setQueryData(queryKeys.queueSummary(), event.event.value);
    }
  });
  return useQuery<QueueSummary>({
    queryKey: queryKeys.queueSummary(),
    queryFn: skipToken,
  }).data;
}

/** Subscribes to GPU telemetry. Best-effort: frames may drop (D106). */
export function useTelemetry(): TelemetryEvent | undefined {
  const queryClient = useQueryClient();
  useChannel(TELEMETRY_CHANNEL, TelemetryEventSchema, (event) => {
    queryClient.setQueryData(queryKeys.telemetry(), event);
  });
  return useQuery<TelemetryEvent>({
    queryKey: queryKeys.telemetry(),
    queryFn: skipToken,
  }).data;
}
