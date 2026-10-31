import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import {
  authorize,
  channelRoutes,
  type ChannelClient,
} from "../src/mocks/channels";
import { WS_PROTOCOL } from "../src/ws/manager";
import { refusal } from "./security";

// The WebSocket channels (A§13.2) over `ws`, wired to the mock backend's
// transport-free channel routes, which MSW also links in the browser.

function adapt(socket: WebSocket, url: URL): ChannelClient {
  return {
    url,
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    onMessage: (listener) =>
      socket.on("message", (data) => listener(String(data))),
    onClose: (listener) => socket.on("close", listener),
  };
}

function reject(socket: Duplex, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
}

export function channelServer(hosts: Set<string>) {
  // Only the wire-format subprotocol is echoed; the token one never is.
  const server = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) =>
      protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false,
  });

  return (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (refusal(request, hosts)) return reject(socket, "403 Forbidden");
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const route = channelRoutes.find((r) => r.pattern.test(url.pathname));
    if (!route) return reject(socket, "404 Not Found");
    const protocols = (request.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    server.handleUpgrade(request, socket, head, (ws) => {
      const client = adapt(ws, url);
      if (!authorize(client, protocols)) return;
      const match = url.pathname.match(route.pattern);
      if (match) route.connect(client, match);
    });
  };
}
