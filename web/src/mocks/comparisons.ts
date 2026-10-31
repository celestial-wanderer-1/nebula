import { create } from "@bufbuild/protobuf";
import { anyUnpack, timestampFromMs } from "@bufbuild/protobuf/wkt";
import { typeNameOf } from "../entities/content";
import {
  ComparedOutputSchema,
  ComparisonSchema,
  ScalarRowSchema,
  type Comparison,
  type CreateComparisonRequest,
} from "../gen/nebula/core/v1/comparison_pb";
import { OutputKind, type RunOutput } from "../gen/nebula/core/v1/output_pb";
import {
  fieldLabel,
  quantityOf,
  toleranceOf,
  withinTolerance,
} from "../schema/annotations";
import { mockSchema } from "./fixtures";
import type { MockStore, StoreResult } from "./store";

// Cross-run comparison within a project (A§13.7, D104): scalar tables
// flagged against declared tolerances (D43), and the outputs the Runs
// share, for overlaid profiles, difference fields and linked views.

const key = (output: RunOutput) => `${output.nodeId}/${output.name}`;

export class ComparisonService {
  private comparisons: Comparison[] = [];
  private next = 1;

  constructor(private readonly store: MockStore) {}

  clear(): void {
    this.comparisons = [];
    this.next = 1;
  }

  list(projectId: string): Comparison[] {
    return this.comparisons.filter((c) =>
      c.runIds.every((id) => this.store.run(projectId, id)),
    );
  }

  get(projectId: string, id: string): Comparison | undefined {
    return this.list(projectId).find((c) => c.id === id);
  }

  create(
    projectId: string,
    request: Pick<CreateComparisonRequest, "runIds" | "region">,
  ): StoreResult<Comparison> {
    const runs = request.runIds.map((id) => this.store.run(projectId, id));
    if (request.runIds.length < 2) {
      return {
        ok: false,
        status: 422,
        code: "invalid",
        message: "Compare at least two runs",
      };
    }
    if (runs.some((run) => !run)) {
      return {
        ok: false,
        status: 422,
        code: "invalid",
        message: "Runs compare within one project (D51)",
      };
    }
    const outputs = request.runIds.map((id) => this.store.runOutputs(id));
    // Outputs every Run has, in the first Run's order.
    const shared = outputs[0]!.filter((o) =>
      outputs.every((list) => list.some((other) => key(other) === key(o))),
    );
    const comparison = create(ComparisonSchema, {
      id: `cmp-${this.next++}`,
      runIds: request.runIds,
      region: request.region,
      createdAt: timestampFromMs(this.store.clock.now()),
      scalars: shared
        .filter((o) => o.kind === OutputKind.SCALARS)
        .flatMap((o) => scalarRows(key(o), outputs)),
      outputs: shared
        .filter(
          (o) =>
            o.kind !== OutputKind.SCALARS &&
            o.kind !== OutputKind.FIELD_OPERATOR,
        )
        .map((o) =>
          create(ComparedOutputSchema, {
            key: key(o),
            kind: o.kind,
            subContract: o.subContract,
            regionType: o.regionType,
            refs: outputs.map((list) => {
              const match = list.find((other) => key(other) === key(o))!;
              return {
                runId: match.runId,
                nodeId: match.nodeId,
                outputName: match.name,
                contentHash: match.contentHash,
              };
            }),
          }),
        ),
    });
    this.comparisons.push(comparison);
    return { ok: true, value: comparison };
  }
}

/** Rows of a scalars output across Runs, each flagged against its tolerance. */
function scalarRows(outputKey: string, outputs: RunOutput[][]) {
  const values = outputs.map((list) => {
    const output = list.find((o) => key(o) === outputKey);
    const desc =
      output?.scalars && mockSchema.getMessage(typeNameOf(output.scalars));
    const message =
      desc && output?.scalars ? anyUnpack(output.scalars, desc) : undefined;
    return {
      output,
      desc,
      message: message as Record<string, unknown> | undefined,
    };
  });
  const desc = values.find((v) => v.desc)?.desc;
  if (!desc) return [];
  return desc.fields
    .filter((field) => field.fieldKind === "scalar")
    .map((field) => {
      const cells = values.map((v) => ({
        runId: v.output?.runId ?? "",
        value: v.message ? Number(v.message[field.localName] ?? 0) : undefined,
      }));
      const tolerance = toleranceOf(field);
      let maxAbs = 0;
      let maxRel = 0;
      let outside = false;
      const present = cells
        .filter((c) => c.value !== undefined)
        .map((c) => c.value!);
      for (const a of present) {
        for (const b of present) {
          const diff = Math.abs(a - b);
          maxAbs = Math.max(maxAbs, diff);
          const scale = Math.max(Math.abs(a), Math.abs(b));
          if (scale > 0) maxRel = Math.max(maxRel, diff / scale);
          if (!withinTolerance(a, b, tolerance)) outside = true;
        }
      }
      return create(ScalarRowSchema, {
        output: outputKey,
        quantity: field.name,
        label: fieldLabel(field),
        unit: quantityOf(field)?.unit ?? "",
        cells,
        tolerance,
        outOfTolerance: outside,
        maxAbsDiff: maxAbs,
        maxRelDiff: maxRel,
      });
    });
}
