import type { IncomingMessage, ServerResponse } from "node:http";
import { getResponse } from "msw";
import { restHandlers } from "../src/mocks/handlers";
import { securityHeaders, sendError } from "./security";

// The REST API, answered by the mock backend's MSW handlers: a Node request
// becomes a Fetch Request, and the handlers' Response is written back.

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function toFetchRequest(request: IncomingMessage, body: Buffer): Request {
  const host = request.headers.host ?? "";
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    for (const item of [value].flat()) headers.append(name, item);
  }
  const method = request.method ?? "GET";
  return new Request(new URL(request.url ?? "/", `http://${host}`), {
    method,
    headers,
    body:
      method === "GET" || method === "HEAD" ? undefined : new Uint8Array(body),
  });
}

export async function serveApi(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const host = request.headers.host ?? "";
  const fetchRequest = toFetchRequest(request, await readBody(request));
  const reply = await getResponse(restHandlers, fetchRequest, {
    baseUrl: `http://${host}`,
  });
  if (!reply) {
    sendError(response, host, 404, "not_found", "No such API route");
    return;
  }
  const headers: Record<string, string> = {
    ...securityHeaders(host),
    "Cache-Control": "no-store",
  };
  reply.headers.forEach((value, name) => (headers[name] = value));
  response.writeHead(reply.status, headers);
  response.end(Buffer.from(await reply.arrayBuffer()));
}
