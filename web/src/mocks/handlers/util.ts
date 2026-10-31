import {
  create,
  fromJson,
  toJson,
  type DescMessage,
  type JsonValue,
  type MessageInitShape,
} from "@bufbuild/protobuf";
import { HttpResponse } from "msw";
import { ENTITY_SEGMENTS } from "../../api/entities";
import type { EntityKind } from "../../gen/nebula/core/v1/entity_pb";
import { ApiErrorSchema } from "../../gen/nebula/core/v1/errors_pb";
import type { StoreResult } from "../store";
import { mockSchema } from "../fixtures";
import { MOCK_TOKEN } from "../token";

export function proto<Desc extends DescMessage>(
  schema: Desc,
  message: MessageInitShape<Desc>,
  init?: ResponseInit,
) {
  return HttpResponse.json(
    toJson(schema, create(schema, message), {
      registry: mockSchema.typeRegistry,
    }),
    init,
  );
}

export function apiError(status: number, code: string, message: string) {
  return proto(ApiErrorSchema, { code, message }, { status });
}

export function notFound(what: string) {
  return apiError(404, "not_found", `${what} not found`);
}

export async function readProto<Desc extends DescMessage>(
  schema: Desc,
  request: Request,
) {
  return fromJson(schema, (await request.json()) as JsonValue, {
    registry: mockSchema.typeRegistry,
  });
}

/** The server requires the per-launch token on every request (D137). */
export function unauthorized(request: Request) {
  return request.headers.get("Authorization") === `Bearer ${MOCK_TOKEN}`
    ? undefined
    : apiError(401, "unauthorized", "Missing or invalid token");
}

const kindBySegment = new Map(
  Object.entries(ENTITY_SEGMENTS)
    .filter(([, segment]) => segment)
    .map(([kind, segment]) => [segment, Number(kind) as EntityKind]),
);

export function entityKind(segment: unknown): EntityKind | undefined {
  return typeof segment === "string" ? kindBySegment.get(segment) : undefined;
}

/** Maps a store result to its response; failures become ApiError bodies. */
export function reply<T>(
  result: StoreResult<T>,
  respond: (value: T) => Response,
): Response {
  return result.ok
    ? respond(result.value)
    : apiError(result.status, result.code, result.message);
}

export const created = { status: 201 };

export const nameRequired = () =>
  proto(
    ApiErrorSchema,
    {
      code: "invalid",
      message: "Validation failed",
      violations: [{ path: "name", message: "A name is required" }],
    },
    { status: 422 },
  );
export const noContent = () => new HttpResponse(null, { status: 204 });
