// The per-launch token (D137). `nebula serve` prints a URL carrying it in the
// fragment; the UI keeps it in memory only and never in cookies or storage.
let token: string | undefined;

/**
 * Reads `#token=...` from the address bar, keeps the token in memory and
 * removes the fragment so it does not stay in history or get copied.
 */
export function bootstrapToken(): string | undefined {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const fromUrl = params.get("token");
  if (fromUrl) {
    token = fromUrl;
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, "", pathname + search);
  }
  return token;
}

export function getToken(): string | undefined {
  return token;
}

export function setTokenForTesting(value: string | undefined): void {
  token = value;
}
