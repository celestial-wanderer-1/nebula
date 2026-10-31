import { create } from "@bufbuild/protobuf";
import { useEffect } from "react";
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
  type ListEntitiesResponse,
} from "../gen/nebula/core/v1/entity_pb";
import type { ListRunOutputsResponse } from "../gen/nebula/core/v1/output_pb";
import {
  ListQueueResponseSchema,
  QueueEventSchema,
  type ListQueueResponse,
  type QueueEvent,
  type QueueSummary,
} from "../gen/nebula/core/v1/queue_pb";
import {
  RunEventSchema,
  type Run,
  type RunEvent,
} from "../gen/nebula/core/v1/run_pb";
import {
  TelemetryEventSchema,
  type TelemetryEvent,
} from "../gen/nebula/core/v1/telemetry_pb";
import { useChannel } from "./context";
import { runProgress } from "./runProgress";

export const entityChannelPath = (projectId: string) =>
  `/ws/projects/${encodeURIComponent(projectId)}/entities`;
export const QUEUE_CHANNEL = "/ws/queue";
export const TELEMETRY_CHANNEL = "/ws/telemetry";

/**
 * Applies an entity-change event to the query cache. A draft or list is
 * refetched only when the event's revision is newer than the cached one, so
 * a client's own saves, already in the cache, cause no refetch (D148). Each
 * is checked on its own: a draft can arrive first (a 409's current draft)
 * while the list still lists an older revision.
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
      }
      const listed = queryClient
        .getQueryData<ListEntitiesResponse>(listKey)
        ?.entities.find((entity) => entity.id === id);
      if (!listed || change.revision > listed.revision) {
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

export const runChannelPath = (runId: string) =>
  `/ws/runs/${encodeURIComponent(runId)}`;

/**
 * Applies a queue event (D106): counts and the queue overwrite what is
 * cached; a Run's state change refetches that Run and its project's list.
 */
export function applyQueueEvent(
  queryClient: QueryClient,
  event: QueueEvent,
): void {
  switch (event.event.case) {
    case "summary":
      queryClient.setQueryData(queryKeys.queueSummary(), event.event.value);
      break;
    case "entries": {
      const { entries } = event.event.value;
      queryClient.setQueryData<ListQueueResponse>(queryKeys.queue(), (held) =>
        create(ListQueueResponseSchema, { entries, summary: held?.summary }),
      );
      break;
    }
    case "runState": {
      const { projectId, runId, studyId } = event.event.value;
      const run = queryClient.getQueryData<Run>(
        queryKeys.run(projectId, runId),
      );
      if (!run || run.state !== event.event.value.state) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.run(projectId, runId),
          exact: true,
        });
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.runs(projectId),
        exact: true,
      });
      if (studyId) {
        void queryClient.invalidateQueries({
          queryKey: [projectId, "studies", studyId],
        });
      }
      break;
    }
    default:
      break;
  }
}

/**
 * Subscribes to the queue channel: counts, the queue and Run state changes.
 * Mounted by the shell, so it stays open while the app is open.
 */
export function useQueueSummary(): QueueSummary | undefined {
  const queryClient = useQueryClient();
  useChannel(
    QUEUE_CHANNEL,
    QueueEventSchema,
    (event) => applyQueueEvent(queryClient, event),
    () => void queryClient.invalidateQueries({ queryKey: queryKeys.queue() }),
  );
  return useQuery<QueueSummary>({
    queryKey: queryKeys.queueSummary(),
    queryFn: skipToken,
  }).data;
}

/**
 * Applies a Run event. A Run snapshot is state from the acknowledged log
 * and overwrites the cached Run (D106); steps and outputs patch it; logs
 * and residuals go to the progress buffers, which may drop.
 */
export function applyRunEvent(
  queryClient: QueryClient,
  projectId: string,
  event: RunEvent,
): void {
  const { runId } = event;
  const key = queryKeys.run(projectId, runId);
  switch (event.event.case) {
    case "run":
      queryClient.setQueryData(key, event.event.value);
      break;
    case "step": {
      const step = event.event.value;
      queryClient.setQueryData<Run>(
        key,
        (run) =>
          run && {
            ...run,
            steps: run.steps.map((s) => (s.nodeId === step.nodeId ? step : s)),
          },
      );
      break;
    }
    case "output": {
      const output = event.event.value;
      queryClient.setQueryData<ListRunOutputsResponse>(
        queryKeys.runOutputs(projectId, runId),
        (held) =>
          held && {
            ...held,
            outputs: [
              ...held.outputs.filter(
                (o) => !(o.nodeId === output.nodeId && o.name === output.name),
              ),
              output,
            ],
          },
      );
      break;
    }
    case "log":
      runProgress.addLog(runId, event.event.value);
      break;
    case "residual":
      runProgress.addResidual(runId, event.event.value);
      break;
    case "checkpoint":
      runProgress.addCheckpoint(runId);
      break;
    default:
      break;
  }
}

/**
 * Follows one Run while its page is open (docs/UI.md 6.6). The server sends
 * the Run and the progress it still holds on every (re)connect, so the
 * buffers start over each time.
 */
export function useRunChannel(projectId: string, runId: string): void {
  const queryClient = useQueryClient();
  useEffect(() => runProgress.reset(runId), [runId]);
  useChannel(
    runId ? runChannelPath(runId) : undefined,
    RunEventSchema,
    (event) => applyRunEvent(queryClient, projectId, event),
    () => {
      runProgress.reset(runId);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.runOutputs(projectId, runId),
      });
    },
  );
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
