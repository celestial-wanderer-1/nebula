import { setNonce } from "get-nonce";

/** Placeholder in index.html; a server that sets no nonce leaves it. */
export const CSP_NONCE_PLACEHOLDER = "NEBULA_CSP_NONCE";

/**
 * Passes the page's CSP nonce to the libraries that insert <style>
 * elements (Radix's scroll lock through react-style-singleton), so a
 * strict `style-src` admits them (D117). Returns the nonce applied.
 */
export function applyCspNonce(doc: Document = document): string | undefined {
  const nonce = doc
    .querySelector('meta[name="csp-nonce"]')
    ?.getAttribute("content");
  if (!nonce) return undefined;
  setNonce(nonce);
  return nonce;
}
