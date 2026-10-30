import { create } from "@bufbuild/protobuf";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { EntityDraftSchema } from "../gen/nebula/core/v1/entity_pb";
import { VersionInfoSchema } from "../gen/nebula/core/v1/version_pb";
import { server } from "../mocks/node";
import { connect } from "../test/render";
import { apiJson } from "./client";
import {
  ApiRequestError,
  AuthError,
  DraftConflictError,
  NetworkError,
  NotFoundError,
  ServerError,
  ValidationError,
} from "./errors";
import { setTokenForTesting } from "./token";

function respond(status: number, body: Record<string, unknown>) {
  server.use(http.get("/version", () => HttpResponse.json(body, { status })));
  return apiJson("/version", VersionInfoSchema);
}

describe("apiJson", () => {
  it("sends the token as a bearer header and decodes protobuf JSON", async () => {
    let auth: string | null = null;
    server.use(
      http.get("/version", ({ request }) => {
        auth = request.headers.get("Authorization");
        return HttpResponse.json({ apiVersion: "1", futureField: true });
      }),
    );
    connect();
    const info = await apiJson("/version", VersionInfoSchema);
    expect(auth).toBe("Bearer mock-token");
    // Unknown fields from a newer server are ignored, not fatal.
    expect(info.apiVersion).toBe("1");
  });

  it("maps 401 and 403 to AuthError", async () => {
    setTokenForTesting("wrong");
    await expect(apiJson("/version", VersionInfoSchema)).rejects.toBeInstanceOf(
      AuthError,
    );
    connect();
    await expect(respond(403, { message: "Origin" })).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("maps 404 to NotFoundError with the server message", async () => {
    connect();
    const error = await respond(404, {
      code: "nf",
      message: "No such project",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as Error).message).toBe("No such project");
  });

  it("maps 422 to ValidationError with field violations", async () => {
    connect();
    const error = await respond(422, {
      message: "Invalid",
      violations: [{ path: "grid.nr", message: "Too small" }],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).violations).toMatchObject([
      { path: "grid.nr", message: "Too small" },
    ]);
  });

  it("maps a 409 draft conflict to DraftConflictError with the server draft", async () => {
    connect();
    const error = await respond(409, {
      message: "Changed",
      current: { id: "geo-main", name: "Theirs", revision: 9 },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DraftConflictError);
    expect((error as DraftConflictError).current).toEqual(
      create(EntityDraftSchema, {
        id: "geo-main",
        name: "Theirs",
        revision: 9,
      }),
    );
  });

  it("maps other statuses to ServerError and ApiRequestError", async () => {
    connect();
    await expect(respond(503, {})).rejects.toBeInstanceOf(ServerError);
    const plain = await respond(409, { message: "Busy" }).catch(
      (e: unknown) => e,
    );
    expect(plain).toBeInstanceOf(ApiRequestError);
    expect(plain).not.toBeInstanceOf(DraftConflictError);
  });

  it("maps a failed connection to NetworkError", async () => {
    connect();
    server.use(http.get("/version", () => HttpResponse.error()));
    await expect(apiJson("/version", VersionInfoSchema)).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});
