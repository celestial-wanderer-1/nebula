import { useEffect, useMemo } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Line,
  LineBasicMaterial,
  LineLoop,
} from "three";
import { MeshTopology } from "../../gen/nebula/core/v1/geometry_pb";
import type { DecodedMesh } from "./mesh";

/** The BufferGeometry of a decoded mesh; positions stay origin-relative. */
function useMeshGeometry(decoded: DecodedMesh | undefined) {
  const geometry = useMemo(() => {
    const built = new BufferGeometry();
    if (!decoded) return built;
    built.setAttribute("position", new BufferAttribute(decoded.positions, 3));
    if (decoded.indices) {
      built.setIndex(new BufferAttribute(decoded.indices, 1));
      built.computeVertexNormals();
    }
    built.computeBoundingSphere();
    return built;
  }, [decoded]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

/**
 * A decoded mesh drawn at its origin (D156): a surface, or a line through
 * its positions. For backdrops without picking, such as region placement.
 */
export function MeshObject({
  decoded,
  colour,
  opacity = 1,
}: {
  decoded: DecodedMesh;
  colour: string;
  opacity?: number;
}) {
  const geometry = useMeshGeometry(decoded);
  const line = useMemo(() => {
    if (decoded.topology === MeshTopology.TRIANGLES) return undefined;
    const material = new LineBasicMaterial({
      color: colour,
      transparent: opacity < 1,
      opacity,
    });
    const object =
      decoded.topology === MeshTopology.LINE_LOOP
        ? new LineLoop(geometry, material)
        : new Line(geometry, material);
    object.position.set(...decoded.origin);
    return object;
  }, [decoded, geometry, colour, opacity]);
  useEffect(() => () => line?.material.dispose(), [line]);

  if (line) return <primitive object={line} />;
  return (
    <mesh geometry={geometry} position={decoded.origin}>
      <meshStandardMaterial
        color={colour}
        side={DoubleSide}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  );
}
