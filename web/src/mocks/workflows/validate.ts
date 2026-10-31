import { create } from "@bufbuild/protobuf";
import type { Any } from "@bufbuild/protobuf/wkt";
import type { Registry } from "@bufbuild/protobuf";
import { unpackAs } from "../../entities/content";
import type { EntityRef } from "../../gen/nebula/core/v1/entity_pb";
import {
  GeometrySchema,
  type Geometry,
} from "../../gen/nebula/core/v1/geometry_pb";
import type { Extension } from "../../gen/nebula/core/v1/plugin_pb";
import {
  IssueSeverity,
  ValidationIssueSchema,
  type ValidationIssue,
} from "../../gen/nebula/core/v1/project_pb";
import { ScenarioSchema } from "../../gen/nebula/core/v1/scenario_pb";
import type { Workflow } from "../../gen/nebula/core/v1/workflow_pb";
import { structuralIssues } from "../../workflow/graph";
import { stepOf } from "../../workflow/ports";
import { checkGeometry } from "../tessellate";

/** What validation needs from the store besides the workflow. */
export interface ValidationContext {
  extensions: ReadonlyMap<string, Extension>;
  /** Traits of the project's concept (D64). */
  conceptTraits: readonly string[];
  /** Content of an entity as a reference resolves it (D107). */
  resolve: (ref: EntityRef) => Any | undefined;
  /** A component's shape as a geometry references it, for closure checks. */
  shapeOf: (geometry: Geometry, componentId: string) => Any | undefined;
  /** Geometries of the Runs that produced stored outputs (D22). */
  storedGeometries: (runId: string) => Geometry[];
  registry: Registry;
  /** Installed GPUs; requests above it are rejected (A§14.1). */
  gpusInstalled: number;
}

const issue = (
  path: string,
  code: string,
  message: string,
  severity = IssueSeverity.ERROR,
): ValidationIssue =>
  create(ValidationIssueSchema, { severity, path, code, message });

/** Geometric traits from symmetry metadata (D94, D113). */
export function geometryTraits(geometry: Geometry): string[] {
  return geometry.symmetry?.axisymmetric ? ["axisymmetric"] : [];
}

/**
 * The mock server's workflow validation (A§3.4 step rules): the structural
 * checks the editor also makes, then traits against the concept and the
 * geometry symmetry (D64, D113), scenario circuits against the geometry
 * and filament closure (D114, D145), and GPU and rank counts (D116).
 */
export function validateWorkflow(
  workflow: Workflow,
  context: ValidationContext,
  gpus: number,
): ValidationIssue[] {
  const issues = structuralIssues(workflow, context.extensions);
  const geometries: Geometry[] = [];

  for (const node of workflow.nodes) {
    const step = stepOf(node);
    if (node.kind.case === "storedOutput" && node.kind.value.runId) {
      geometries.push(...context.storedGeometries(node.kind.value.runId));
    }
    if (!step) continue;
    const bound = (port: string) =>
      step.bindings.find((b) => b.port === port)?.ref;
    const geometryRef = bound("geometry");
    const geometryContent = geometryRef && context.resolve(geometryRef);
    const geometry =
      geometryContent && unpackAs(GeometrySchema, geometryContent);
    if (geometryRef?.id && !geometryContent) {
      issues.push(
        issue(
          `nodes/${node.id}/ports/geometry`,
          "missing_input",
          "The bound geometry version does not exist",
        ),
      );
    }
    if (geometry) {
      geometries.push(geometry);
      for (const found of checkGeometry(
        geometry,
        (id) => context.shapeOf(geometry, id),
        context.registry,
      )) {
        if (found.severity !== IssueSeverity.ERROR) continue;
        issues.push(
          issue(
            `nodes/${node.id}/ports/geometry`,
            found.path.startsWith("circuits/") ? "circuit" : "geometry",
            `Geometry: ${found.message}`,
          ),
        );
      }
    }

    const scenarioRef = bound("scenario");
    const scenarioContent = scenarioRef && context.resolve(scenarioRef);
    if (scenarioContent) {
      const scenario = unpackAs(ScenarioSchema, scenarioContent);
      // Currents key circuits of the step's geometry, else the scenario's.
      const target =
        geometry ??
        (scenario.geometry &&
          unpackAs(GeometrySchema, context.resolve(scenario.geometry)));
      const circuits = new Set(target?.circuits.map((c) => c.id) ?? []);
      for (const current of scenario.currents) {
        if (target && !circuits.has(current.circuitId)) {
          issues.push(
            issue(
              `nodes/${node.id}/ports/scenario`,
              "circuit",
              `Scenario current names circuit “${current.circuitId}”, which the geometry does not have`,
            ),
          );
        }
      }
    }
  }

  const traits = new Set([
    ...context.conceptTraits,
    ...geometries.flatMap(geometryTraits),
  ]);
  for (const node of workflow.nodes) {
    const extension = context.extensions.get(stepOf(node)?.extensionId ?? "");
    for (const trait of extension?.requiredTraits ?? []) {
      if (traits.has(trait)) continue;
      issues.push(
        issue(
          `nodes/${node.id}`,
          "missing_trait",
          `${extension?.displayName} requires “${trait}”, which neither the project concept nor the geometry provides`,
        ),
      );
    }
    const counts = extension?.gpu?.rankCounts ?? [];
    // A step listing only one rank count does not scale: it runs on rank 0.
    if (gpus > 0 && counts.length > 1 && !counts.includes(gpus)) {
      issues.push(
        issue(
          `nodes/${node.id}`,
          "rank_count",
          `${extension?.displayName} runs on ${counts.join(", ")} GPUs, not ${gpus}`,
        ),
      );
    }
  }
  if (gpus > context.gpusInstalled) {
    issues.push(
      issue(
        "",
        "gpus",
        `${gpus} GPUs requested; ${context.gpusInstalled} are installed`,
      ),
    );
  }
  return issues;
}
