import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ElementRef,
} from "react";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  LineLoop,
  Matrix4,
} from "three";
import {
  MeshTopology,
  type ComponentTessellation,
} from "../../gen/nebula/core/v1/geometry_pb";
import { decodeMesh, type DecodedMesh } from "../../viewers/three/mesh";
import { endSpan, GEOMETRY_DRAW } from "../../perf";
import { WebGlBoundary } from "../../viewers/WebGlBoundary";
import { meshRevisions, replicaCounts } from "./scene";
import { DEFAULT_CAMERA, useGeometryView, type CameraState } from "./store";

// The 3D view of the geometry editor (docs/UI.md Section 6.3). Loaded
// lazily, so three.js is a separate chunk.

const COLOURS = { surface: "#8aa4c0", line: "#f2c14e", selected: "#7dd3c8" };
const REPLICA_OPACITY = 0.3;

export interface ViewportProps {
  geometryId: string;
  /** The tessellations to draw; those without a mesh are skipped. */
  components: readonly ComponentTessellation[];
  /** Replica angles about z per component ID; none when replicas are off. */
  replicas: ReadonlyMap<string, readonly number[]>;
  selectedId?: string;
  onSelect: (componentId: string) => void;
}

export function Viewport({
  geometryId,
  components,
  replicas,
  selectedId,
  onSelect,
}: ViewportProps) {
  return (
    <div
      className="viewport"
      data-testid="viewport"
      data-mesh-revisions={meshRevisions(components)}
      data-replicas={replicaCounts(components, replicas)}
    >
      <WebGlBoundary key={geometryId}>
        <Scene
          geometryId={geometryId}
          components={components}
          replicas={replicas}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      </WebGlBoundary>
    </div>
  );
}

function Scene({
  geometryId,
  components,
  replicas,
  selectedId,
  onSelect,
}: ViewportProps) {
  // Read once: the camera is restored on mount, then owned by the controls.
  const [camera] = useState<CameraState>(
    () => useGeometryView.getState().cameras[geometryId] ?? DEFAULT_CAMERA,
  );
  return (
    <Canvas
      camera={{
        position: camera.position,
        up: [0, 0, 1],
        near: 0.05,
        far: 500,
      }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, -10, 20]} intensity={1.2} />
      {components.map(
        (component) =>
          component.mesh && (
            <ComponentObject
              key={component.componentId}
              tessellation={component}
              angles={replicas.get(component.componentId) ?? NO_ANGLES}
              selected={component.componentId === selectedId}
              onSelect={onSelect}
            />
          ),
      )}
      <Controls geometryId={geometryId} target={camera.target} />
      <DrawnMark components={components} />
    </Canvas>
  );
}

const NO_ANGLES: readonly number[] = [];

/**
 * Ends the draw span once a frame with the arrived meshes is rendered:
 * frame callbacks run before the render, so it waits one more.
 */
function DrawnMark({
  components,
}: {
  components: readonly ComponentTessellation[];
}) {
  const shownSince = useRef(0);
  useEffect(() => {
    shownSince.current = performance.now();
  }, [components]);
  useFrame(() => {
    const since = shownSince.current;
    const triangles = components.reduce(
      (n, c) => n + (c.mesh?.indices.length ?? 0) / 12,
      0,
    );
    requestAnimationFrame(() => endSpan(GEOMETRY_DRAW, { triangles }, since));
  });
  return null;
}

/** Orbit controls; the camera is saved per geometry when a drag ends. */
function Controls({
  geometryId,
  target,
}: {
  geometryId: string;
  target: CameraState["target"];
}) {
  const setCamera = useGeometryView((state) => state.setCamera);
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={false}
      target={target}
      onEnd={() => {
        const current = controls.current;
        if (!current) return;
        setCamera(geometryId, {
          position: current.object.position.toArray(),
          target: current.target.toArray(),
        });
      }}
    />
  );
}

/**
 * One component's mesh, plus dimmed replicas that share its BufferGeometry.
 * Each sits at the mesh origin (D156) rotated about z, so a replica is the
 * rotated original. Clicking any of them selects the
 * component; a drag (orbiting the camera) does not.
 */
function ComponentObject({
  tessellation,
  angles,
  selected,
  onSelect,
}: {
  tessellation: ComponentTessellation;
  angles: readonly number[];
  selected: boolean;
  onSelect: (componentId: string) => void;
}) {
  const { mesh, componentId } = tessellation;
  const decoded = useMemo(() => mesh && decodeMesh(mesh), [mesh]);
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

  if (!decoded || decoded.positions.length === 0) return null;
  const select = (event: ThreeEvent<MouseEvent>) => {
    // R3F reports a click after a drag that starts and ends on the object;
    // it gates misses the same way.
    if (event.delta > 2) return;
    event.stopPropagation();
    onSelect(componentId);
  };
  if (decoded.topology === MeshTopology.TRIANGLES) {
    const colour = selected ? COLOURS.selected : COLOURS.surface;
    return (
      <group>
        <mesh geometry={geometry} position={decoded.origin} onClick={select}>
          <meshStandardMaterial
            color={colour}
            emissive={selected ? COLOURS.selected : "#000000"}
            emissiveIntensity={selected ? 0.35 : 0}
            side={DoubleSide}
          />
        </mesh>
        {angles.length > 0 && (
          <Replicas
            geometry={geometry}
            origin={decoded.origin}
            angles={angles}
            colour={colour}
            onClick={select}
          />
        )}
      </group>
    );
  }
  const instances = [0, ...angles];
  return (
    <group>
      {instances.map((angle, index) => (
        <group key={index} rotation={[0, 0, angle]}>
          <LineObject
            geometry={geometry}
            loop={decoded.topology === MeshTopology.LINE_LOOP}
            origin={decoded.origin}
            colour={selected ? COLOURS.selected : COLOURS.line}
            opacity={index > 0 ? REPLICA_OPACITY : 1}
            onClick={select}
          />
        </group>
      ))}
    </group>
  );
}

/**
 * The dimmed symmetry replicas of a surface as one InstancedMesh: one draw
 * call however many copies (docs/UI.md P7). Each instance is the original
 * at its origin (D156), rotated about z.
 */
function Replicas({
  geometry,
  origin,
  angles,
  colour,
  onClick,
}: {
  geometry: BufferGeometry;
  origin: DecodedMesh["origin"];
  angles: readonly number[];
  colour: string;
  onClick: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const instanced = ref.current;
    if (!instanced) return;
    const placed = new Matrix4().makeTranslation(...origin);
    angles.forEach((angle, i) =>
      instanced.setMatrixAt(
        i,
        new Matrix4().makeRotationZ(angle).multiply(placed),
      ),
    );
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
  }, [angles, origin]);
  return (
    <instancedMesh
      // A new count needs a new InstancedMesh.
      key={angles.length}
      ref={ref}
      args={[geometry, undefined, angles.length]}
      onClick={onClick}
    >
      <meshStandardMaterial
        color={colour}
        side={DoubleSide}
        transparent
        opacity={REPLICA_OPACITY}
      />
    </instancedMesh>
  );
}

/**
 * A THREE.Line or LineLoop as a primitive: R3F's <line> collides with the
 * SVG element type. The material is owned here; the geometry by the parent.
 */
function LineObject({
  geometry,
  loop,
  origin,
  colour,
  opacity,
  onClick,
}: {
  geometry: BufferGeometry;
  loop: boolean;
  origin: readonly [number, number, number];
  colour: string;
  opacity: number;
  onClick: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const line = useMemo(() => {
    const material = new LineBasicMaterial({
      color: colour,
      transparent: opacity < 1,
      opacity,
    });
    const object = loop
      ? new LineLoop(geometry, material)
      : new Line(geometry, material);
    object.position.set(...origin);
    return object;
  }, [geometry, loop, origin, colour, opacity]);
  useEffect(() => () => line.material.dispose(), [line]);
  return <primitive object={line} onClick={onClick} />;
}
