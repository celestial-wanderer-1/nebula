import { ws, type WebSocketHandlerConnection } from "msw";
import { authorize, channelRoutes, type ChannelClient } from "./channels";

/** Adapts an MSW WebSocket connection to a transport-free channel client. */
function adapt({ client }: WebSocketHandlerConnection): ChannelClient {
  return {
    url: client.url,
    send: (data) => client.send(data),
    close: (code, reason) => client.close(code, reason),
    onMessage: (listener) =>
      client.addEventListener("message", (event) =>
        listener(String(event.data)),
      ),
    onClose: (listener) => client.addEventListener("close", listener),
  };
}

export const wsHandlers = channelRoutes.map((route) =>
  ws.link(route.pattern).addEventListener("connection", (connection) => {
    const client = adapt(connection);
    if (!authorize(client, [connection.info.protocols ?? []].flat())) return;
    const match = client.url.pathname.match(route.pattern);
    if (match) route.connect(client, match);
  }),
);
