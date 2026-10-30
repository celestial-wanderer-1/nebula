import { create, toJsonString } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import { ws, type WebSocketHandlerConnection } from "msw";
import { EntityChangeSchema } from "../gen/nebula/core/v1/entity_pb";
import { QueueEventSchema } from "../gen/nebula/core/v1/queue_pb";
import { TelemetryEventSchema } from "../gen/nebula/core/v1/telemetry_pb";
import { WS_CLOSE_UNAUTHORIZED, WS_TOKEN_PREFIX } from "../ws/manager";
import { store } from "./state";
import { MOCK_TOKEN } from "./token";

const GPU_MEMORY = 192n * 1024n ** 3n;
const TELEMETRY_INTERVAL_MS = 1000;

/** Checks the token subprotocol as the server does (D137). */
function authorize({ client, info }: WebSocketHandlerConnection): boolean {
  const offered = [info.protocols ?? []].flat();
  if (offered.includes(`${WS_TOKEN_PREFIX}${MOCK_TOKEN}`)) return true;
  client.close(WS_CLOSE_UNAUTHORIZED, "Missing or invalid token");
  return false;
}

const entities = ws.link(/\/ws\/projects\/[^/]+\/entities$/);
const queue = ws.link(/\/ws\/queue$/);
const telemetry = ws.link(/\/ws\/telemetry$/);

export const wsHandlers = [
  entities.addEventListener("connection", (connection) => {
    if (!authorize(connection)) return;
    const { client } = connection;
    const projectId = decodeURIComponent(
      client.url.pathname.split("/").at(-2) ?? "",
    );
    const off = store.onEntityChange((change) => {
      if (change.projectId === projectId) {
        client.send(toJsonString(EntityChangeSchema, change));
      }
    });
    client.addEventListener("close", off);
  }),

  queue.addEventListener("connection", (connection) => {
    if (!authorize(connection)) return;
    const { client } = connection;
    const send = () =>
      client.send(
        toJsonString(
          QueueEventSchema,
          create(QueueEventSchema, {
            event: { case: "summary", value: store.queue },
          }),
        ),
      );
    send();
    const off = store.onQueueChange(send);
    client.addEventListener("close", off);
  }),

  telemetry.addEventListener("connection", (connection) => {
    if (!authorize(connection)) return;
    const { client } = connection;
    const send = () => {
      const busy = store.queue.gpusBusy;
      client.send(
        toJsonString(
          TelemetryEventSchema,
          create(TelemetryEventSchema, {
            time: timestampNow(),
            gpus: Array.from({ length: store.queue.gpusTotal }, (_, i) => ({
              gpuIndex: i,
              model: "MI300X",
              utilization: i < busy ? 0.8 + 0.15 * Math.random() : 0,
              memoryUsedBytes: i < busy ? GPU_MEMORY / 2n : 0n,
              memoryTotalBytes: GPU_MEMORY,
              runId: i < busy ? "r-12" : "",
            })),
          }),
        ),
      );
    };
    send();
    const timer = setInterval(send, TELEMETRY_INTERVAL_MS);
    client.addEventListener("close", () => clearInterval(timer));
  }),
];
