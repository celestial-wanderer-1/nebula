import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import type { EntityDraft } from "../gen/nebula/core/v1/entity_pb";
import {
  ApiErrorSchema,
  DraftConflictSchema,
  type ApiError,
  type FieldViolation,
} from "../gen/nebula/core/v1/errors_pb";
import { getTypeRegistry } from "./registry";

/** A non-2xx response. Subclasses type the cases the UI handles. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: ApiError,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 401 or 403: missing or rejected token (D137). */
export class AuthError extends ApiRequestError {}

export class NotFoundError extends ApiRequestError {}

/** 409 on a conditional draft update (D148). */
export class DraftConflictError extends ApiRequestError {
  constructor(
    message: string,
    readonly current: EntityDraft,
  ) {
    super(409, message);
  }
}

/** 422: the server's authoritative validation failed (A§13.1). */
export class ValidationError extends ApiRequestError {
  get violations(): FieldViolation[] {
    return this.body?.violations ?? [];
  }
}

export class ServerError extends ApiRequestError {}

/** The request never produced a response. */
export class NetworkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NetworkError";
  }
}

async function readJson(response: Response): Promise<JsonValue | undefined> {
  try {
    return (await response.json()) as JsonValue;
  } catch {
    return undefined;
  }
}

function decodeApiError(json: JsonValue | undefined): ApiError | undefined {
  try {
    return json === undefined
      ? undefined
      : fromJson(ApiErrorSchema, json, { ignoreUnknownFields: true });
  } catch {
    return undefined;
  }
}

/** Maps a non-2xx response to a typed error. */
export async function errorFromResponse(
  response: Response,
): Promise<ApiRequestError> {
  const { status } = response;
  const json = await readJson(response);

  if (
    status === 409 &&
    typeof json === "object" &&
    json !== null &&
    !Array.isArray(json) &&
    "current" in json
  ) {
    const conflict = fromJson(DraftConflictSchema, json, {
      ignoreUnknownFields: true,
      registry: getTypeRegistry(),
    });
    if (conflict.current) {
      return new DraftConflictError(
        conflict.message || "The draft was changed by another client",
        conflict.current,
      );
    }
  }

  const body = decodeApiError(json);
  const message = body?.message || response.statusText || `HTTP ${status}`;
  if (status === 401 || status === 403) {
    return new AuthError(status, message, body);
  }
  if (status === 404) {
    return new NotFoundError(status, message, body);
  }
  if (status === 422) {
    return new ValidationError(status, message, body);
  }
  if (status >= 500) {
    return new ServerError(status, message, body);
  }
  return new ApiRequestError(status, message, body);
}
