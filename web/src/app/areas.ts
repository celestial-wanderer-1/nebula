// Project areas of A§13.3 and the phase of docs/UI.md Section 8 that builds
// each one.
export interface Area {
  path: string;
  label: string;
  phase: string;
}

export const PROJECT_AREAS: readonly Area[] = [
  { path: "geometry", label: "Geometry", phase: "P2" },
  { path: "libraries", label: "Libraries", phase: "P2" },
  { path: "regions", label: "Regions", phase: "P3" },
  { path: "scenarios", label: "Scenarios", phase: "P3" },
  { path: "conductor-networks", label: "Conductor networks", phase: "P3" },
  { path: "workflows", label: "Workflows", phase: "P3" },
  { path: "runs", label: "Runs and queue", phase: "P4" },
  { path: "results", label: "Results", phase: "P5" },
  { path: "comparison", label: "Comparison", phase: "P6" },
  { path: "studies", label: "Studies", phase: "P6" },
  { path: "storage", label: "Storage", phase: "P6" },
];
