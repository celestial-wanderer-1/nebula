import { useMemo } from "react";
import { ViewerKind, type ViewPayload } from "../gen/nebula/core/v1/view_pb";
import { GltfError } from "./gltf";
import { lazyView } from "./lazy";
import { cellCount, decodeScene } from "./polydata";
import type { CameraPose, VtkCanvasProps } from "./vtk/VtkCanvas";

const VtkCanvasSlot = lazyView<VtkCanvasProps>(
  () => import("./vtk/VtkCanvas").then((module) => module.VtkCanvas),
  {
    loading: "Loading 3D viewer…",
    unavailable: "3D viewer unavailable: vtk.js could not be loaded.",
    className: "vtk-canvas",
  },
);

/**
 * A vtk.js payload (2D contour, 3D field, Poincaré, mode structure;
 * A§13.6). What it draws is exposed on the element for tests.
 */
export function VtkPayload({
  payload,
  camera,
  onCamera,
}: {
  payload: ViewPayload;
  camera?: CameraPose;
  onCamera?: (pose: CameraPose) => void;
}) {
  const decoded = useMemo(() => {
    try {
      return { scene: decodeScene(payload) };
    } catch (error) {
      if (error instanceof GltfError) return { error: error.message };
      throw error;
    }
  }, [payload]);
  if (decoded.error) {
    return (
      <p className="field-error" role="alert">
        The payload was refused: {decoded.error}
      </p>
    );
  }
  const scene = decoded.scene;
  if (!scene) return null;
  const points = scene.pieces.reduce((n, p) => n + p.points.length / 3, 0);
  const planar =
    payload.viewer === ViewerKind.CONTOUR_2D ||
    payload.viewer === ViewerKind.POINCARE ||
    payload.viewer === ViewerKind.MODE_STRUCTURE;
  return (
    <div
      className="vtk-payload"
      role="img"
      aria-label={payload.title || "3D view"}
      data-pieces={scene.pieces.map((p) => p.name).join(",")}
      data-points={points}
      data-cells={scene.pieces
        .map(
          (p) => cellCount(p.polys) + cellCount(p.lines) + cellCount(p.verts),
        )
        .reduce((a, b) => a + b, 0)}
      data-origin={scene.origin.join(",")}
      data-scalars={scene.pieces
        .map((p) => p.activeScalars)
        .filter(Boolean)
        .join(",")}
      data-body={payload.body.case}
    >
      <VtkCanvasSlot
        scene={scene}
        planar={planar}
        camera={camera}
        onCamera={onCamera}
      />
      <Legend payload={payload} />
    </div>
  );
}

function Legend({ payload }: { payload: ViewPayload }) {
  if (payload.body.case !== "polydata") return null;
  const arrays = payload.body.value.pieces.flatMap((piece) =>
    piece.pointData.filter((a) => a.name === piece.activeScalars),
  );
  if (arrays.length === 0) return null;
  return (
    <ul className="legend" aria-label="Colour scales">
      {arrays.map((array, i) => (
        <li key={i}>
          {array.name}
          {array.unit && ` [${array.unit}]`}: {array.rangeMin.toPrecision(3)} to{" "}
          {array.rangeMax.toPrecision(3)}
        </li>
      ))}
    </ul>
  );
}
