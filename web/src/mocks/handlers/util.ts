import {
  create,
  fromJson,
  toJson,
  type DescMessage,
  type JsonValue,
  type MessageInitShape,
} from "@bufbuild/protobuf";
import { HttpResponse } from "msw";
import { ApiErrorSchema } from "../../gen/nebula/core/v1/errors_pb";
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
