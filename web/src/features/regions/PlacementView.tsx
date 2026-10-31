import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Points,
  PointsMaterial,
} from "three";
import type { ComponentTessellation } from "../../gen/nebula/core/v1/geometry_pb";
import { WebGlBoundary } from "../../viewers/WebGlBoundary";
import { decodeMesh } from "../../viewers/three/mesh";
import { MeshObject } from "../../viewers/three/MeshObject";
import type { RegionPreview, Vec } from "./preview";

// The region placement view (docs/UI.md 6.4): the region over its geometry
// in react-three-fiber. Loaded lazily, so three.js is a separate chunk.

const COLOURS = { geometry: "#8aa4c0", covered: "#7dd3c8", region: "#f2c14e" };

export interface PlacementViewProps {
  components: readonly ComponentTessellation[];
  preview: RegionPreview;
}

/** Camera distance and target that frame every drawn point. */
function frame(
  components: readonly ComponentTessellation[],
  preview: RegionPreview,
): { target: Vec; distance: number } {
  const points: Vec[] = [...preview.points, ...preview.lines.flat()];
  for (const component of components) {
    const origin = component.mesh?.origin;
    if (origin) points.push([origin.x, origin.y, origin.z]);
  }
  if (points.length === 0) return { target: [0, 0, 0], distance: 20 };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, p[i]!);
      max[i] = Math.max(max[i]!, p[i]!);
    }
  }
  const target: Vec = [0, 1, 2].map((i) => (min[i]! + max[i]!) / 2) as Vec;
  const size = Math.max(...[0, 1, 2].map((i) => max[i]! - min[i]!), 4);
  return { target, distance: size * 1.8 };
}

export function PlacementView({ components, preview }: PlacementViewProps) {
  const covered = new Set(preview.components);
  const meshes = components.filter((component) => component.mesh);
  const { target, distance } = useMemo(
    () => frame(components, preview),
    [components, preview],
  );
  return (
    <div
      className="viewport placement-view"
      data-testid="placement"
      data-meshes={meshes.length}
      data-region-lines={preview.lines.length}
      data-region-points={preview.points.length}
      data-covered={[...covered].join(",")}
    >
      <WebGlBoundary>
        <Canvas
          camera={{
            position: [
              target[0],
              target[1] - distance,
              target[2] + distance / 3,
            ],
            up: [0, 0, 1],
            near: 0.05,
            far: 1000,
          }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[10, -10, 20]} intensity={1.1} />
          {meshes.map((component) => (
            <MeshObject
              key={component.componentId}
              decoded={decodeMesh(component.mesh!)}
              colour={
                covered.has(component.componentId)
                  ? COLOURS.covered
                  : COLOURS.geometry
              }
              opacity={covered.has(component.componentId) ? 0.9 : 0.35}
            />
          ))}
          {preview.lines.map((line, index) => (
            <Polyline key={index} points={line} />
          ))}
          {preview.points.length > 0 && <Dots points={preview.points} />}
          <OrbitControls makeDefault enableDamping={false} target={target} />
        </Canvas>
      </WebGlBoundary>
    </div>
  );
}

function positions(points: readonly Vec[]) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(points.flat()), 3),
  );
  return geometry;
}

function Polyline({ points }: { points: readonly Vec[] }) {
  const line = useMemo(
    () =>
      new Line(
        positions(points),
        new LineBasicMaterial({ color: COLOURS.region }),
      ),
    [points],
  );
  useEffect(
    () => () => {
      line.geometry.dispose();
      line.material.dispose();
    },
    [line],
  );
  return <primitive object={line} />;
}

function Dots({ points }: { points: readonly Vec[] }) {
  const dots = useMemo(
    () =>
      new Points(
        positions(points),
        new PointsMaterial({ color: COLOURS.region, size: 0.08 }),
      ),
    [points],
  );
  useEffect(
    () => () => {
      dots.geometry.dispose();
      dots.material.dispose();
    },
    [dots],
  );
  return <primitive object={dots} />;
}
