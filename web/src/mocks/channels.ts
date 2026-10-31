import { create, fromJsonString, toJsonString } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import { EntityChangeSchema } from "../gen/nebula/core/v1/entity_pb";
import { QueueEventSchema } from "../gen/nebula/core/v1/queue_pb";
import { RunEventSchema } from "../gen/nebula/core/v1/run_pb";
import { TelemetryEventSchema } from "../gen/nebula/core/v1/telemetry_pb";
import {
  ViewReplySchema,
  ViewRequestSchema,
} from "../gen/nebula/core/v1/view_pb";
import { WS_CLOSE_UNAUTHORIZED, WS_TOKEN_PREFIX } from "../ws/manager";
import { mockSchema } from "./fixtures";
import { store } from "./state";
import { MOCK_TOKEN } from "./token";

// The mock's WebSocket channels (A§13.2), independent of the transport:
// MSW links them in the browser and in Vitest (ws.ts).

const GPU_MEMORY = 192n * 1024n ** 3n;
const TELEMETRY_INTERVAL_MS = 1000;

/** One connected client, whatever carries it. */
export interface ChannelClient {
  url: URL;
  send(data: string): void;
  close(code: number, reason: string): void;
  onMessage(listener: (data: string) => void): void;
  onClose(listener: () => void): void;
}

export interface ChannelRoute {
  pattern: RegExp;
  connect(client: ChannelClient, match: RegExpMatchArray): void;
}

/** Checks the token subprotocol as the server does (D137). */
export function authorize(
  client: ChannelClient,
  protocols: readonly string[],
): boolean {
  if (protocols.includes(`${WS_TOKEN_PREFIX}${MOCK_TOKEN}`)) return true;
  client.close(WS_CLOSE_UNAUTHORIZED, "Missing or invalid token");
  return false;
}

const json = { registry: mockSchema.typeRegistry };

export const channelRoutes: ChannelRoute[] = [
  {
    pattern: /\/ws\/projects\/([^/]+)\/entities$/,
    connect(client, match) {
      const projectId = decodeURIComponent(match[1] ?? "");
      const off = store.onEntityChange((change) => {
        if (change.projectId === projectId) {
          client.send(toJsonString(EntityChangeSchema, change));
        }
      });
      client.onClose(off);
    },
  },
  {
    pattern: /\/ws\/queue$/,
    connect(client) {
      const send = (
        event: Parameters<typeof toJsonString<typeof QueueEventSchema>>[1],
      ) => client.send(toJsonString(QueueEventSchema, event, json));
      send(
        create(QueueEventSchema, {
          event: { case: "summary", value: store.queue },
        }),
      );
      send(
        create(QueueEventSchema, {
          event: {
            case: "entries",
            value: { entries: store.engine.entries() },
          },
        }),
      );
      client.onClose(store.engine.onQueueEvent(send));
    },
  },
  {
    pattern: /\/ws\/runs\/([^/]+)$/,
    connect(client, match) {
      const runId = decodeURIComponent(match[1] ?? "");
      const run = store.engine.run(runId);
      if (!run) {
        client.close(4404, "Run not found");
        return;
      }
      const send = (
        event: Parameters<typeof toJsonString<typeof RunEventSchema>>[1],
      ) => client.send(toJsonString(RunEventSchema, event, json));
      // The current state, then the recent progress the server still holds.
      send(
        create(RunEventSchema, {
          runId,
          time: timestampNow(),
          event: { case: "run", value: run },
        }),
      );
      for (const event of store.engine.recent(runId)) send(event);
      client.onClose(store.engine.onRunEvent(runId, send));
    },
  },
  {
    // Request and reply: each ViewRequest gets a ViewReply with its ID.
    pattern: /\/ws\/views$/,
    connect(client) {
      let open = true;
      client.onClose(() => (open = false));
      client.onMessage((data) => {
        let request;
        try {
          request = fromJsonString(ViewRequestSchema, data, json);
        } catch {
          return;
        }
        const { reply, delayMs } = store.views.handle(request);
        const send = () => {
          if (open) client.send(toJsonString(ViewReplySchema, reply, json));
        };
        if (delayMs) setTimeout(send, delayMs);
        else send();
      });
    },
  },
  {
    pattern: /\/ws\/telemetry$/,
    connect(client) {
      const send = () => {
        const owners = store.engine.gpuAssignments();
        client.send(
          toJsonString(
            TelemetryEventSchema,
            create(TelemetryEventSchema, {
              time: timestampNow(),
              gpus: owners.map((runId, i) => ({
                gpuIndex: i,
                model: store.gpuModel,
                utilization: runId ? 0.8 + 0.15 * Math.random() : 0,
                memoryUsedBytes: runId ? GPU_MEMORY / 2n : 0n,
                memoryTotalBytes: GPU_MEMORY,
                runId: runId ?? "",
              })),
            }),
          ),
        );
      };
      send();
      const timer = setInterval(send, TELEMETRY_INTERVAL_MS);
      client.onClose(() => clearInterval(timer));
    },
  },
];
