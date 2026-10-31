import "@kitware/vtk.js/Rendering/Profiles/Geometry";
import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray";
import vtkCellArray from "@kitware/vtk.js/Common/Core/CellArray";
import vtkPoints from "@kitware/vtk.js/Common/Core/Points";
import vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor";
import vtkColorTransferFunction from "@kitware/vtk.js/Rendering/Core/ColorTransferFunction";
import vtkColorMaps from "@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper";
import vtkGenericRenderWindow from "@kitware/vtk.js/Rendering/Misc/GenericRenderWindow";
import { useEffect, useRef } from "react";
import type { DecodedPiece, DecodedScene } from "../polydata";

// The vtk.js canvas of the 2D contour, 3D field, Poincaré and mode-structure
// viewers (A§13.6). Loaded lazily, so vtk.js is its own chunk.

export interface CameraPose {
  position: [number, number, number];
  focalPoint: [number, number, number];
  viewUp: [number, number, number];
}

export interface VtkCanvasProps {
  scene: DecodedScene;
  /** A poloidal-plane view: looking along y, z up, parallel projection. */
  planar?: boolean;
  /** A shared camera, for linked views (A§13.7). */
  camera?: CameraPose;
  onCamera?: (pose: CameraPose) => void;
}

const LINE_COLOUR: [number, number, number] = [0.95, 0.76, 0.31];
const SURFACE_COLOUR: [number, number, number] = [0.54, 0.64, 0.75];

function toPolyData(piece: DecodedPiece) {
  const polyData = vtkPolyData.newInstance();
  const points = vtkPoints.newInstance({ numberOfComponents: 3 });
  points.setData(piece.points, 3);
  polyData.setPoints(points);
  if (piece.verts)
    polyData.setVerts(vtkCellArray.newInstance({ values: piece.verts }));
  if (piece.lines)
    polyData.setLines(vtkCellArray.newInstance({ values: piece.lines }));
  if (piece.polys)
    polyData.setPolys(vtkCellArray.newInstance({ values: piece.polys }));
  for (const array of piece.pointData) {
    polyData.getPointData().addArray(
      vtkDataArray.newInstance({
        name: array.name,
        values: array.values,
        numberOfComponents: array.components,
      }),
    );
  }
  if (piece.activeScalars)
    polyData.getPointData().setActiveScalars(piece.activeScalars);
  return polyData;
}

export function VtkCanvas({ scene, planar, camera, onCamera }: VtkCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<ReturnType<typeof vtkGenericRenderWindow.newInstance>>();
  const applying = useRef(false);

  useEffect(() => {
    const window = vtkGenericRenderWindow.newInstance({
      background: [0.04, 0.07, 0.1],
    });
    window.setContainer(container.current!);
    window.resize();
    view.current = window;
    const observer = new ResizeObserver(() => window.resize());
    observer.observe(container.current!);
    return () => {
      observer.disconnect();
      window.delete();
      view.current = undefined;
    };
  }, []);

  useEffect(() => {
    const window = view.current;
    if (!window) return;
    const renderer = window.getRenderer();
    renderer.removeAllViewProps();
    const deletable: { delete: () => void }[] = [];
    for (const piece of scene.pieces) {
      const polyData = toPolyData(piece);
      const mapper = vtkMapper.newInstance();
      mapper.setInputData(polyData);
      const actor = vtkActor.newInstance();
      actor.setMapper(mapper);
      // The payload's float32 points are relative to its origin; the actor
      // puts them back in double precision (D156).
      actor.setPosition(...scene.origin);
      const scalars = piece.pointData.find(
        (a) => a.name === piece.activeScalars,
      );
      if (scalars) {
        const lut = vtkColorTransferFunction.newInstance();
        const preset = vtkColorMaps.getPresetByName("Viridis (matplotlib)");
        if (preset) lut.applyColorMap(preset);
        lut.setMappingRange(...scalars.range);
        lut.updateRange();
        mapper.setLookupTable(lut);
        mapper.setScalarRange(...scalars.range);
        mapper.setScalarVisibility(true);
        deletable.push(lut);
      } else {
        mapper.setScalarVisibility(false);
        actor
          .getProperty()
          .setColor(...(piece.polys ? SURFACE_COLOUR : LINE_COLOUR));
      }
      if (piece.verts) actor.getProperty().setPointSize(3);
      if (piece.lines && !piece.polys) actor.getProperty().setLineWidth(2);
      renderer.addActor(actor);
      deletable.push(actor, mapper, polyData);
    }
    const active = renderer.getActiveCamera();
    if (planar) {
      active.setParallelProjection(true);
      active.setPosition(0, -1, 0);
      active.setFocalPoint(0, 0, 0);
      active.setViewUp(0, 0, 1);
    } else {
      active.setParallelProjection(false);
      active.setPosition(1, -1.4, 0.9);
      active.setFocalPoint(0, 0, 0);
      active.setViewUp(0, 0, 1);
    }
    renderer.resetCamera();
    window.getRenderWindow().render();
    return () => deletable.forEach((item) => item.delete());
  }, [scene, planar]);

  // Linked views share one camera (A§13.7).
  useEffect(() => {
    const window = view.current;
    if (!window || !camera) return;
    const active = window.getRenderer().getActiveCamera();
    applying.current = true;
    active.setPosition(...camera.position);
    active.setFocalPoint(...camera.focalPoint);
    active.setViewUp(...camera.viewUp);
    window.getRenderer().resetCameraClippingRange();
    window.getRenderWindow().render();
    applying.current = false;
  }, [camera]);

  useEffect(() => {
    const window = view.current;
    if (!window || !onCamera) return;
    const active = window.getRenderer().getActiveCamera();
    const subscription = active.onModified(() => {
      if (applying.current) return;
      onCamera({
        position: active.getPosition() as CameraPose["position"],
        focalPoint: active.getFocalPoint() as CameraPose["focalPoint"],
        viewUp: active.getViewUp() as CameraPose["viewUp"],
      });
    });
    return () => subscription?.unsubscribe();
  }, [onCamera]);

  return <div ref={container} className="vtk-canvas" />;
}
