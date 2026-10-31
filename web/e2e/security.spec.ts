import { request as httpRequest } from "node:http";
import { WebSocket as NodeWebSocket } from "ws";
import { AUTHORIZATION, REAL, TOKEN } from "./backend";
import { expect, test } from "./test";

// The server's browser-facing controls (A§16.1, D90, D117, D137), checked
// against the stub server; the mock has no HTTP layer to check.
test.skip(!REAL, "Needs the stub server (E2E_TARGET=real)");

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

/** A raw request, so Host and Origin can be anything. */
function rawGet(
  baseURL: string,
  path: string,
  headers: Record<string, string>,
): Promise<number> {
  const { hostname, port } = new URL(baseURL);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { hostname, port, path, headers: { ...AUTHORIZATION, ...headers } },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on("error", reject);
    request.end();
  });
}

test("refuses a spoofed Host, against DNS rebinding (D90)", async ({
  baseURL,
}) => {
  expect(await rawGet(baseURL!, "/", { Host: "attacker.example" })).toBe(403);
  expect(
    await rawGet(baseURL!, "/projects", { Host: "attacker.example:4174" }),
  ).toBe(403);
});

test("refuses cross-origin requests", async ({ request, baseURL }) => {
  const response = await request.get("/projects", {
    headers: { ...AUTHORIZATION, Origin: "http://attacker.example" },
  });
  expect(response.status()).toBe(403);
  const same = await request.get("/projects", {
    headers: { ...AUTHORIZATION, Origin: baseURL! },
  });
  expect(same.status()).toBe(200);
});

test("requires the token in the Authorization header (D137)", async ({
  request,
}) => {
  expect((await request.get("/projects")).status()).toBe(401);
  const token = TOKEN.split("=")[1]!;
  expect((await request.get(`/projects?token=${token}`)).status()).toBe(401);
  expect(
    (await request.get("/projects", { headers: AUTHORIZATION })).status(),
  ).toBe(200);
});

test("closes a WebSocket without the token subprotocol (D137)", async ({
  page,
}) => {
  await page.goto(`/${TOKEN}`);
  const codes = await page.evaluate(async () => {
    const close = (protocols: string[]) =>
      new Promise<number>((resolve) => {
        const socket = new WebSocket(
          `ws://${location.host}/ws/queue`,
          protocols,
        );
        socket.onclose = (event) => resolve(event.code);
      });
    return Promise.all([
      close(["nebula.v1"]),
      close(["nebula.v1", "nebula.token.wrong"]),
    ]);
  });
  expect(codes).toEqual([4401, 4401]);
});

test("refuses a cross-site WebSocket upgrade and echoes only nebula.v1", async ({
  baseURL,
}) => {
  const url = `${baseURL!.replace("http", "ws")}/ws/queue`;
  const token = `nebula.token.${TOKEN.split("=")[1]!}`;
  const open = (origin: string) =>
    new Promise<string>((resolve) => {
      const socket = new NodeWebSocket(url, ["nebula.v1", token], { origin });
      socket.on("open", () => {
        resolve(`open ${socket.protocol}`);
        socket.close();
      });
      socket.on("unexpected-response", (_request, response) =>
        resolve(`refused ${response.statusCode}`),
      );
    });
  expect(await open("http://attacker.example")).toBe("refused 403");
  expect(await open(baseURL!)).toBe("open nebula.v1");
});

test("answers unknown API paths with JSON, and browser routes with the app", async ({
  request,
}) => {
  const api = await request.get("/projects/p-baseline/nothing-here", {
    headers: AUTHORIZATION,
  });
  expect(api.status()).toBe(404);
  expect(api.headers()["content-type"]).toContain("application/json");
  expect(await api.json()).toMatchObject({ code: "not_found" });

  const deep = await request.get("/p/p-baseline/runs/r-11");
  expect(deep.status()).toBe(200);
  expect(deep.headers()["content-type"]).toContain("text/html");
  expect(deep.headers()["cache-control"]).toBe("no-cache");

  const asset = await request.get("/assets/missing.js");
  expect(asset.status()).toBe(404);
});

test("sends the strict CSP with a fresh nonce on every page", async ({
  request,
}) => {
  const policies: string[] = [];
  for (const path of ["/", "/p/p-baseline"]) {
    const response = await request.get(path);
    const headers = response.headers();
    expect(headers).toMatchObject(SECURITY_HEADERS);
    const csp = headers["content-security-policy"]!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-");
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(await response.text()).toContain(`content="${nonce}"`);
    policies.push(csp);
  }
  expect(policies[0]).not.toBe(policies[1]);

  const api = await request.get("/version", { headers: AUTHORIZATION });
  expect(api.headers()).toMatchObject(SECURITY_HEADERS);
  expect(api.headers()["cache-control"]).toBe("no-store");
});

test("serves hashed assets as immutable and ships no mock", async ({
  request,
}) => {
  const html = await (await request.get("/")).text();
  const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  expect(script).toBeTruthy();
  const asset = await request.get(script!);
  expect(asset.headers()["cache-control"]).toContain("immutable");
  expect((await request.get("/mockServiceWorker.js")).status()).toBe(404);
});
