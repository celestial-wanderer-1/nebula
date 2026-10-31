// Little-endian binary arrays of the wire (A§13.6), decoded to typed
// arrays. On a little-endian machine, as browsers are in practice, this is
// one copy; elsewhere, or for odd offsets, it reads value by value.

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function read<T extends Float32Array | Uint32Array>(
  bytes: Uint8Array,
  count: number,
  make: (buffer: ArrayBuffer) => T,
  get: (view: DataView, at: number) => number,
): T {
  if (LITTLE_ENDIAN) {
    // The copy is aligned whatever the source offset, and owned.
    const own = bytes.slice(0, count * 4);
    return make(own.buffer);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = make(new ArrayBuffer(count * 4));
  for (let i = 0; i < count; i++) out[i] = get(view, i * 4);
  return out;
}

/** `count` float32 values, by default as many as the bytes hold. */
export function float32s(
  bytes: Uint8Array,
  count = Math.floor(bytes.byteLength / 4),
): Float32Array {
  return read(
    bytes,
    count,
    (buffer) => new Float32Array(buffer),
    (view, at) => view.getFloat32(at, true),
  );
}

export function uint32s(
  bytes: Uint8Array,
  count = Math.floor(bytes.byteLength / 4),
): Uint32Array {
  return read(
    bytes,
    count,
    (buffer) => new Uint32Array(buffer),
    (view, at) => view.getUint32(at, true),
  );
}
