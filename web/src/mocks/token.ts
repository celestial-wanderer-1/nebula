// Token the mock backend accepts; vite.config.ts prints the matching URL.
export const MOCK_TOKEN = "mock-token";

let accepted = MOCK_TOKEN;

/** The token requests must carry; the stub server sets a per-launch one. */
export function acceptedToken(): string {
  return accepted;
}

export function setAcceptedToken(token: string): void {
  accepted = token;
}
export const MOCK_BUILD_ID = "mock-build-1";
export const MOCK_API_VERSION = "1";
