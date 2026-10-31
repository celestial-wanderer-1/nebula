import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { isApiPath, WS_PREFIX } from "../src/api/paths";
import { setAcceptedToken } from "../src/mocks/token";
import { CONTROL_PREFIX, serveControl } from "./control";
import { serveApi } from "./rest";
import { allowedHosts, refusal, sendError } from "./security";
import { staticSite } from "./static";
import { channelServer } from "./ws";

// A stand-in for `nebula serve` (docs/UI.md P7): the production bundle and
// the API on one loopback origin, with the server's browser-facing controls,
// answered by the mock backend. End-to-end tests run against it.

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "4174" },
    dist: { type: "string", default: "dist" },
  },
});
const port = Number(values.port);
const token =
  process.env.NEBULA_STUB_TOKEN || randomBytes(24).toString("base64url");
setAcceptedToken(token);

const hosts = allowedHosts(port);
const site = staticSite(resolve(values.dist));
const upgrade = channelServer(hosts);

/** A plain request for a WebSocket channel. */
async function upgradeRequired(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const host = request.headers.host ?? "";
  sendError(response, host, 426, "upgrade_required", "Use a WebSocket");
}

const server = createServer((request, response) => {
  const host = request.headers.host ?? "";
  const refused = refusal(request, hosts);
  if (refused) return sendError(response, host, 403, "forbidden", refused);
  const { pathname } = new URL(request.url ?? "/", `http://${host}`);
  const handle = pathname.startsWith(CONTROL_PREFIX)
    ? serveControl
    : isApiPath(pathname)
      ? serveApi
      : pathname.startsWith(WS_PREFIX)
        ? upgradeRequired
        : site.serve;
  handle(request, response).catch((error: unknown) => {
    console.error(error);
    if (!response.headersSent) {
      sendError(response, host, 500, "internal", "Internal error");
    } else response.destroy();
  });
});
server.on("upgrade", upgrade);

// Loopback only: the server is never reachable from the network (A§16.1).
server.listen(port, "127.0.0.1", () => {
  console.log(`Nebula stub server: http://127.0.0.1:${port}/#token=${token}`);
});
