// A minimal binary glTF reader for isosurface payloads: the first mesh
// primitive's positions and triangle indices. glTF payloads may not
// reference external URIs (D117); one that does is refused.

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;

interface Accessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}

interface Gltf {
  buffers?: { uri?: string; byteLength: number }[];
  images?: { uri?: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
  accessors?: Accessor[];
  meshes?: {
    primitives: { attributes: { POSITION?: number }; indices?: number }[];
  }[];
}

export class GltfError extends Error {}

export interface GltfMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export function parseGlb(bytes: Uint8Array): GltfMesh {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) {
    throw new GltfError("Not a binary glTF");
  }
  let json: Gltf | undefined;
  let bin: Uint8Array | undefined;
  for (let at = 12; at + 8 <= bytes.byteLength;) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const chunk = bytes.subarray(at + 8, at + 8 + length);
    if (type === CHUNK_JSON) {
      json = JSON.parse(new TextDecoder().decode(chunk)) as Gltf;
    } else if (type === CHUNK_BIN) {
      bin = chunk;
    }
    at += 8 + length;
  }
  if (!json || !bin)
    throw new GltfError("The glTF has no JSON or binary chunk");
  // Everything must be embedded (D117).
  const external = [...(json.buffers ?? []), ...(json.images ?? [])].find(
    (item) => item.uri !== undefined,
  );
  if (external) {
    throw new GltfError(`The glTF references an external URI: ${external.uri}`);
  }
  const primitive = json.meshes?.[0]?.primitives[0];
  const read = (index: number | undefined) => {
    const accessor = index === undefined ? undefined : json.accessors?.[index];
    const bufferView = accessor && json.bufferViews?.[accessor.bufferView];
    if (!accessor || !bufferView)
      throw new GltfError("A glTF accessor is missing");
    const offset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const width = { SCALAR: 1, VEC3: 3 }[accessor.type] ?? 1;
    const count = accessor.count * width;
    const data = new DataView(
      bin.buffer,
      bin.byteOffset + offset,
      bufferView.byteLength,
    );
    switch (accessor.componentType) {
      case FLOAT:
        return Float32Array.from({ length: count }, (_, i) =>
          data.getFloat32(i * 4, true),
        );
      case UNSIGNED_INT:
        return Uint32Array.from({ length: count }, (_, i) =>
          data.getUint32(i * 4, true),
        );
      case UNSIGNED_SHORT:
        return Uint32Array.from({ length: count }, (_, i) =>
          data.getUint16(i * 2, true),
        );
      default:
        throw new GltfError(
          `Unsupported component type ${accessor.componentType}`,
        );
    }
  };
  const positions = read(primitive?.attributes.POSITION);
  if (!(positions instanceof Float32Array)) {
    throw new GltfError("glTF positions must be floats");
  }
  const indices =
    primitive?.indices === undefined
      ? Uint32Array.from({ length: positions.length / 3 }, (_, i) => i)
      : (read(primitive.indices) as Uint32Array);
  return { positions, indices };
}
