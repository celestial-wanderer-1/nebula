// Little-endian encodings of view payload arrays (view.proto).

export function f32(values: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) {
    view.setFloat32(i * 4, values[i]!, true);
  }
  return out;
}

export function u32(values: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) {
    view.setUint32(i * 4, values[i]!, true);
  }
  return out;
}

/** VTK cell array layout: a count, then that many point IDs, per cell. */
export function cells(list: readonly (readonly number[])[]): Uint8Array {
  return u32(list.flatMap((ids) => [ids.length, ...ids]));
}

export function range(values: readonly number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return values.length ? [min, max] : [0, 0];
}
