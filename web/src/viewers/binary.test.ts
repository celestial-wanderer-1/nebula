import { describe, expect, it } from "vitest";
import { float32s, uint32s } from "./binary";

/** Little-endian bytes of `values`, placed at an odd offset of a buffer. */
function unaligned(values: number[], type: "f32" | "u32") {
  const buffer = new ArrayBuffer(values.length * 4 + 3);
  const view = new DataView(buffer, 3);
  values.forEach((v, i) =>
    type === "f32"
      ? view.setFloat32(i * 4, v, true)
      : view.setUint32(i * 4, v, true),
  );
  return new Uint8Array(buffer, 3, values.length * 4);
}

describe("binary arrays", () => {
  it("decodes little-endian values at any offset", () => {
    expect([...float32s(unaligned([1.5, -2, 6.25], "f32"))]).toEqual([
      1.5, -2, 6.25,
    ]);
    expect([...uint32s(unaligned([0, 7, 4_000_000_000], "u32"))]).toEqual([
      0, 7, 4_000_000_000,
    ]);
  });

  it("reads the requested count and owns its buffer", () => {
    const bytes = unaligned([1, 2, 3, 4], "f32");
    const head = float32s(bytes, 3);
    expect([...head]).toEqual([1, 2, 3]);
    bytes.fill(0);
    expect(head[0]).toBe(1);
  });
});
