import { create } from "@bufbuild/protobuf";
import {
  SymmetrySchema,
  type GeometryTessellation,
  type Symmetry,
} from "../../gen/nebula/core/v1/geometry_pb";
import {
  IssueSeverity,
  type ValidationIssue,
} from "../../gen/nebula/core/v1/project_pb";

// Issue paths of a geometry's checks (geometry.proto GeometryTessellation).
export const SYMMETRY_PATH = "symmetry";
export const componentPath = (id: string) => `components/${id}`;
export const circuitPath = (id: string) => `circuits/${id}`;

const NO_ISSUES: readonly ValidationIssue[] = [];

/** Issues reported at exactly `path`. */
export function issuesAt(
  tessellation: GeometryTessellation | undefined,
  path: string,
): readonly ValidationIssue[] {
  const issues = tessellation?.issues.filter((issue) => issue.path === path);
  return issues && issues.length > 0 ? issues : NO_ISSUES;
}

/** The worst severity among `issues`; unset when there are none. */
export function worstSeverity(
  issues: readonly ValidationIssue[],
): IssueSeverity | undefined {
  if (issues.length === 0) return undefined;
  return issues.some((issue) => issue.severity === IssueSeverity.ERROR)
    ? IssueSeverity.ERROR
    : IssueSeverity.WARNING;
}

/**
 * Symmetry of a new geometry, from the project's concept (D94, D98):
 * tokamaks and mirrors are axisymmetric; the stellarator starter has five
 * field periods. Unknown concepts default to axisymmetric.
 */
export function defaultSymmetry(conceptId: string | undefined): Symmetry {
  const concept = conceptId?.split(".").pop();
  return concept === "stellarator"
    ? create(SymmetrySchema, { axisymmetric: false, fieldPeriods: 5 })
    : create(SymmetrySchema, { axisymmetric: true, fieldPeriods: 1 });
}
