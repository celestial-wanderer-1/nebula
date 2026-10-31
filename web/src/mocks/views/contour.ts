// Marching squares over a regular grid: the contour segments of a scalar
// field at an isovalue. The mock's PostOp for 2D contours (A§9.5).

export type Point2 = [number, number];

/**
 * Segments of the isoline `level` of `values` (row-major, nx by ny) on the
 * grid spanned by `xs` and `ys`.
 */
export function contourSegments(
  xs: readonly number[],
  ys: readonly number[],
  values: readonly number[],
  level: number,
): [Point2, Point2][] {
  const nx = xs.length;
  const segments: [Point2, Point2][] = [];
  const at = (i: number, j: number) => values[j * nx + i]!;
  const lerp = (a: number, b: number, va: number, vb: number) =>
    va === vb ? a : a + ((level - va) / (vb - va)) * (b - a);
  for (let j = 0; j < ys.length - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      const x0 = xs[i]!;
      const x1 = xs[i + 1]!;
      const y0 = ys[j]!;
      const y1 = ys[j + 1]!;
      // Crossings on the four edges: bottom, right, top, left.
      const edges: (Point2 | undefined)[] = [
        v[0]! < level !== v[1]! < level
          ? [lerp(x0, x1, v[0]!, v[1]!), y0]
          : undefined,
        v[1]! < level !== v[2]! < level
          ? [x1, lerp(y0, y1, v[1]!, v[2]!)]
          : undefined,
        v[3]! < level !== v[2]! < level
          ? [lerp(x0, x1, v[3]!, v[2]!), y1]
          : undefined,
        v[0]! < level !== v[3]! < level
          ? [x0, lerp(y0, y1, v[0]!, v[3]!)]
          : undefined,
      ];
      const hits = edges.filter((p): p is Point2 => p !== undefined);
      if (hits.length === 2) {
        segments.push([hits[0]!, hits[1]!]);
      } else if (hits.length === 4) {
        // A saddle: pair the crossings by the cell's mean.
        const mean = (v[0]! + v[1]! + v[2]! + v[3]!) / 4;
        if (mean < level === v[0]! < level) {
          segments.push([edges[0]!, edges[1]!], [edges[2]!, edges[3]!]);
        } else {
          segments.push([edges[0]!, edges[3]!], [edges[1]!, edges[2]!]);
        }
      }
    }
  }
  return segments;
}
