// @vitest-environment node
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { allowedHosts, contentSecurityPolicy, refusal } from "./security";

const request = (headers: Record<string, string>) =>
  ({ headers }) as unknown as IncomingMessage;

describe("stub server controls (A§16.1)", () => {
  const hosts = allowedHosts(4174);

  it("admits loopback hosts and same-origin requests only", () => {
    expect(refusal(request({ host: "127.0.0.1:4174" }), hosts)).toBeUndefined();
    expect(
      refusal(
        request({ host: "localhost:4174", origin: "http://localhost:4174" }),
        hosts,
      ),
    ).toBeUndefined();
    expect(refusal(request({ host: "evil.example:4174" }), hosts)).toBe(
      "Host not allowed",
    );
    expect(refusal(request({ host: "127.0.0.1:9999" }), hosts)).toBe(
      "Host not allowed",
    );
    expect(
      refusal(
        request({ host: "127.0.0.1:4174", origin: "http://localhost:4174" }),
        hosts,
      ),
    ).toBe("Cross-origin request refused");
    expect(
      refusal(request({ host: "127.0.0.1:4174", origin: "null" }), hosts),
    ).toBe("Cross-origin request refused");
  });

  it("sends a strict policy with the page's nonce", () => {
    const csp = contentSecurityPolicy("127.0.0.1:4174", "abc");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("'nonce-abc'");
    expect(csp).toContain("connect-src 'self' ws://127.0.0.1:4174");
    expect(csp).not.toMatch(/unsafe-(inline|eval)/);
    expect(contentSecurityPolicy("127.0.0.1:4174")).not.toContain("nonce");
  });
});
