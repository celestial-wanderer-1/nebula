import type { IncomingMessage, ServerResponse } from "node:http";
import { unauthorized } from "../src/mocks/handlers/util";
import { scenarios } from "../src/mocks/scenarios";
import { resetMockStore } from "../src/mocks/state";
import { securityHeaders, sendError } from "./security";

// Test controls under /__stub/: not part of the API contract, and absent
// from `nebula serve`. They require the token like any API call.

export const CONTROL_PREFIX = "/__stub/";

type Scenarios = Record<string, (...args: unknown[]) => void>;

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export async function serveControl(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const host = request.headers.host ?? "";
  const authorization = request.headers.authorization ?? "";
  const denied = unauthorized(
    new Request(`http://${host}/`, { headers: { authorization } }),
  );
  if (denied) {
    return sendError(
      response,
      host,
      401,
      "unauthorized",
      "Missing or invalid token",
    );
  }
  if (request.method !== "POST") {
    return sendError(response, host, 405, "method_not_allowed", "Use POST");
  }
  const { pathname } = new URL(request.url ?? "/", `http://${host}`);
  try {
    if (pathname === `${CONTROL_PREFIX}reset`) {
      resetMockStore();
    } else if (pathname === `${CONTROL_PREFIX}scenario`) {
      const { name, args = [] } = (await readJson(request)) as {
        name?: string;
        args?: unknown[];
      };
      const scenario =
        name && Object.hasOwn(scenarios, name)
          ? (scenarios as unknown as Scenarios)[name]
          : undefined;
      if (!scenario) {
        return sendError(
          response,
          host,
          404,
          "not_found",
          `No scenario ${name}`,
        );
      }
      scenario(...args);
    } else {
      return sendError(response, host, 404, "not_found", "No such control");
    }
  } catch (error) {
    return sendError(response, host, 422, "invalid", String(error));
  }
  response.writeHead(204, securityHeaders(host));
  response.end();
}
