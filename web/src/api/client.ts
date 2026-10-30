import {
  create,
  fromJson,
  toJsonString,
  type DescMessage,
  type JsonValue,
  type MessageInitShape,
  type MessageShape,
} from "@bufbuild/protobuf";
import { errorFromResponse, NetworkError } from "./errors";
import { getTypeRegistry } from "./registry";
import { getToken } from "./token";

// The FastAPI server serves the API and the UI from one origin (D90).
export const API_BASE = "";

/** Absolute URL of an API path. Absolute because Node `fetch` needs it. */
export function apiUrl(path: string): string {
  return new URL(API_BASE + path, window.location.origin).toString();
}

export interface RequestOptions {
  method?: string;
  body?: BodyInit;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

/** Sends a request with the token header and maps failures to typed errors. */
export async function apiFetch(
  path: string,
  { method = "GET", body, headers, signal }: RequestOptions = {},
): Promise<Response> {
  const allHeaders = new Headers(headers);
  const token = getToken();
  if (token) {
    allHeaders.set("Authorization", `Bearer ${token}`);
  }
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      body,
      headers: allHeaders,
      signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    throw new NetworkError(`Cannot reach the Nebula server (${path})`, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return response;
}

/** Encodes a request message in the protobuf JSON mapping. */
export function jsonBody<Desc extends DescMessage>(
  schema: Desc,
  message: MessageInitShape<Desc>,
): RequestOptions {
  return {
    body: toJsonString(schema, create(schema, message), {
      registry: getTypeRegistry(),
    }),
    headers: { "Content-Type": "application/json" },
  };
}

/** Sends a request and decodes the protobuf JSON response. */
export async function apiJson<Desc extends DescMessage>(
  path: string,
  response: Desc,
  options: RequestOptions = {},
): Promise<MessageShape<Desc>> {
  const res = await apiFetch(path, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
  });
  // Newer servers may add fields; they are ignored rather than fatal.
  return fromJson(response, (await res.json()) as JsonValue, {
    ignoreUnknownFields: true,
    registry: getTypeRegistry(),
  });
}

export interface DownloadedFile {
  blob: Blob;
  filename?: string;
}

/** Fetches a binary resource, such as a project export. */
export async function apiBlob(
  path: string,
  options: RequestOptions = {},
): Promise<DownloadedFile> {
  const res = await apiFetch(path, options);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1];
  return { blob: await res.blob(), filename };
}
