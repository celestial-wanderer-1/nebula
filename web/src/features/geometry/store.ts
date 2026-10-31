import { create } from "zustand";

// View state of the geometry editor (docs/UI.md Section 6.3): what is
// selected, where each geometry's camera was left and whether replicas show.
// Not server state, so it lives in Zustand rather than the query cache.

export type Selection =
  | { kind: "symmetry" }
  | { kind: "component"; id: string }
  | { kind: "circuit"; id: string };

export type Vec3 = [number, number, number];

export interface CameraState {
  position: Vec3;
  target: Vec3;
}

export const DEFAULT_CAMERA: CameraState = {
  position: [18, -18, 12],
  target: [0, 0, 0],
};

interface GeometryViewState {
  /** The selection and the geometry it belongs to. */
  selected?: { geometryId: string; item: Selection };
  /** Camera per geometry ID, restored when the editor reopens. */
  cameras: Record<string, CameraState>;
  showReplicas: boolean;
  select: (geometryId: string, item: Selection | undefined) => void;
  setCamera: (geometryId: string, camera: CameraState) => void;
  setShowReplicas: (show: boolean) => void;
}

const initial = { selected: undefined, cameras: {}, showReplicas: true };

export const useGeometryView = create<GeometryViewState>()((set) => ({
  ...initial,
  select: (geometryId, item) =>
    set({ selected: item ? { geometryId, item } : undefined }),
  setCamera: (geometryId, camera) =>
    set((state) => ({ cameras: { ...state.cameras, [geometryId]: camera } })),
  setShowReplicas: (showReplicas) => set({ showReplicas }),
}));

/** The selection within `geometryId`; another geometry's selection is none. */
export function useSelection(geometryId: string): Selection | undefined {
  return useGeometryView((state) =>
    state.selected?.geometryId === geometryId ? state.selected.item : undefined,
  );
}

/** Back to the initial state; for tests. */
export function resetGeometryView(): void {
  useGeometryView.setState(initial);
}

export function sameSelection(
  a: Selection | undefined,
  b: Selection | undefined,
): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === "symmetry" || a.id === (b as { id: string }).id;
}
