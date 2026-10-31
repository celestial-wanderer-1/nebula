// A deterministic stand-in for the server's content hashes (D152): FNV-1a
// over 64 bits. Not cryptographic; enough to tell mock contents apart.

const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = (1n << 64n) - 1n;

export function fnv64(...parts: (string | Uint8Array)[]): string {
  let hash = OFFSET;
  const encoder = new TextEncoder();
  for (const part of parts) {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    for (const byte of bytes) {
      hash ^= BigInt(byte);
      hash = (hash * PRIME) & MASK;
    }
    // Separate parts so ("ab", "c") and ("a", "bc") differ.
    hash ^= 0xffn;
    hash = (hash * PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/** "sha256:<16 hex digits>", the shape of the server's hashes. */
export const contentHash = (...parts: (string | Uint8Array)[]) =>
  `sha256:${fnv64(...parts)}`;
