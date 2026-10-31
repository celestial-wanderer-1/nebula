import { create } from "zustand";
import type { CameraPose } from "./vtk/VtkCanvas";

// Linked 3D views share one camera per group (A§13.7): moving one view
// moves the others. View state only, so it lives in Zustand.

interface CameraState {
  poses: Record<string, CameraPose | undefined>;
  setPose: (group: string, pose: CameraPose) => void;
}

export const useCameras = create<CameraState>()((set) => ({
  poses: {},
  setPose: (group, pose) =>
    set((state) => ({ poses: { ...state.poses, [group]: pose } })),
}));

/** Back to the initial state; for tests. */
export function resetCameras(): void {
  useCameras.setState({ poses: {} });
}
