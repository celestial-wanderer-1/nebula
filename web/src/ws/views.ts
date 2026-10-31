import { create, toJsonString } from "@bufbuild/protobuf";
import { useEffect, useRef, useState } from "react";
import { getTypeRegistry } from "../api/registry";
import {
  ViewReplySchema,
  ViewRequestSchema,
  type OutputRef,
  type ViewerKind,
  type ViewParams,
  type ViewPayload,
} from "../gen/nebula/core/v1/view_pb";
import { useChannel, useWsManager } from "./context";

export const VIEWS_CHANNEL = "/ws/views";

export interface ViewJob {
  /** The latest payload received; kept while a newer request is pending. */
  payload?: ViewPayload;
  /** A request is out for parameters newer than `payload`'s. */
  pending: boolean;
  /** The latest payload came from the server's payload cache. */
  cached: boolean;
  error?: string;
}

let sequence = 0;
const newRequestId = () => `view-${Date.now().toString(36)}-${++sequence}`;

/**
 * A view job on /ws/views (A§3.6, docs/UI.md 6.7): each change of output,
 * viewer or parameters sends a request tagged with a fresh ID. The previous
 * payload stays shown, marked pending, until the matching reply arrives;
 * replies to superseded requests are dropped. After a reconnect the
 * pending request is sent again, since replies are not replayed.
 */
export function useViewJob(
  projectId: string,
  output: OutputRef | undefined,
  viewer: ViewerKind,
  params: ViewParams,
  postOp = "",
): ViewJob {
  const manager = useWsManager();
  const [job, setJob] = useState<ViewJob>({ pending: false, cached: false });
  const latest = useRef<{ id: string; frame: string; done: boolean }>();

  // Identifies the request without its ID, so equal requests are not resent.
  const body = output
    ? toJsonString(
        ViewRequestSchema,
        create(ViewRequestSchema, {
          projectId,
          output,
          viewer,
          params,
          postOp,
        }),
        { registry: getTypeRegistry() },
      )
    : "";

  useChannel(
    output ? VIEWS_CHANNEL : undefined,
    ViewReplySchema,
    (reply) => {
      const current = latest.current;
      if (!current || reply.requestId !== current.id) return;
      current.done = true;
      const result = reply.result;
      if (result.case === "payload") {
        setJob({ payload: result.value, pending: false, cached: reply.cached });
      } else {
        const message =
          result.case === "error" ? result.value.message : "The view failed";
        setJob((held) => ({ ...held, pending: false, error: message }));
      }
    },
    () => {
      const current = latest.current;
      if (current && !current.done) manager.send(VIEWS_CHANNEL, current.frame);
    },
  );

  useEffect(() => {
    if (!body) return;
    const id = newRequestId();
    const request = JSON.parse(body) as Record<string, unknown>;
    const frame = JSON.stringify({ ...request, requestId: id });
    latest.current = { id, frame, done: false };
    setJob((held) => ({ ...held, pending: true, error: undefined }));
    manager.send(VIEWS_CHANNEL, frame);
  }, [body, manager]);

  return job;
}
