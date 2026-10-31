import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

// The browser-facing controls `nebula serve` applies (A§16.1, D90, D117,
// D137), as the stub server applies them.

/** Placeholder index.html carries for the per-response nonce. */
export const NONCE_PLACEHOLDER = "NEBULA_CSP_NONCE";

/** The hash of "": Plotly's one empty <style>, filled through the CSSOM. */
const EMPTY_STYLE_HASH =
  "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";

export function newNonce(): string {
  return randomBytes(16).toString("base64");
}

/** The strict Content Security Policy, with this response's style nonce. */
export function contentSecurityPolicy(host: string, nonce?: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    `style-src 'self'${nonce ? ` 'nonce-${nonce}'` : ""} ${EMPTY_STYLE_HASH}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ws://${host}`,
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; ");
}

/** Headers every response carries. */
export function securityHeaders(
  host: string,
  nonce?: string,
): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(host, nonce),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

/**
 * Hosts the server answers to. Checking Host defeats DNS rebinding (D90);
 * checking Origin defeats cross-site requests, including WebSocket upgrades,
 * which the same-origin policy does not cover (D137).
 */
export function allowedHosts(port: number): Set<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
}

/** Why a request is refused before routing, or undefined to admit it. */
export function refusal(
  request: IncomingMessage,
  hosts: Set<string>,
): string | undefined {
  const host = request.headers.host ?? "";
  if (!hosts.has(host)) return "Host not allowed";
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) {
    return "Cross-origin request refused";
  }
  return undefined;
}

export function sendJson(
  response: ServerResponse,
  host: string,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    ...securityHeaders(host),
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

/** The API's error body (A§13.3). */
export function sendError(
  response: ServerResponse,
  host: string,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(response, host, status, { code, message });
}
