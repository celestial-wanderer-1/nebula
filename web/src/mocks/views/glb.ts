// A minimal binary glTF writer for isosurface payloads: one mesh of
// positions and indices in an embedded buffer, no external URIs (D117).

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const pad4 = (n: number) => (n + 3) & ~3;

export function writeGlb(
  positions: Float32Array,
  indices: Uint32Array,
): Uint8Array {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    min[axis] = Math.min(min[axis]!, positions[i]!);
    max[axis] = Math.max(max[axis]!, positions[i]!);
  }
  const json = {
    asset: { version: "2.0", generator: "nebula-mock" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: positions.byteLength + indices.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      {
        buffer: 0,
        byteOffset: positions.byteLength,
        byteLength: indices.byteLength,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length / 3,
        type: "VEC3",
        min,
        max,
      },
      {
        bufferView: 1,
        componentType: 5125,
        count: indices.length,
        type: "SCALAR",
      },
    ],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad4(jsonBytes.length);
  const binLength = pad4(positions.byteLength + indices.byteLength);
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(jsonBytes, 20);
  const bin = 20 + jsonLength;
  view.setUint32(bin, binLength, true);
  view.setUint32(bin + 4, CHUNK_BIN, true);
  out.set(
    new Uint8Array(
      positions.buffer,
      positions.byteOffset,
      positions.byteLength,
    ),
    bin + 8,
  );
  out.set(
    new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength),
    bin + 8 + positions.byteLength,
  );
  return out;
}
