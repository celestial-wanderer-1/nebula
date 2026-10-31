import { create } from "@bufbuild/protobuf";
import { anyUnpack } from "@bufbuild/protobuf/wkt";
import { EntityKind } from "../gen/nebula/core/v1/entity_pb";
import { RunState } from "../gen/nebula/core/v1/run_pb";
import {
  DependentSchema,
  StorageClass,
  StorageUsageSchema,
  type Dependent,
  type StorageUsage,
} from "../gen/nebula/core/v1/storage_pb";
import { WorkflowSchema } from "../gen/nebula/core/v1/workflow_pb";
import type { MockStore, StoreResult } from "./store";

// Project storage (A§4.7, D79, D141): usage by class against a cap,
// eviction of derived artifacts, and deletion of primary results after a
// check of the stored-output references to them.

const GiB = 1024n ** 3n;
const MiB = 1024n ** 2n;
const CAP = 200n * GiB;
const OUTPUT_BYTES = 180n * MiB;
const CHECKPOINT_BYTES = 1200n * MiB;
const VIEW_PAYLOAD_BYTES = 4n * MiB;

const DERIVED = [
  StorageClass.MESHES,
  StorageClass.DISCRETIZED,
  StorageClass.FLUX_COORDINATES,
  StorageClass.VIEW_PAYLOADS,
] as const;

const INITIAL: Partial<Record<StorageClass, bigint>> = {
  [StorageClass.MESHES]: 2n * GiB + 300n * MiB,
  [StorageClass.DISCRETIZED]: 850n * MiB,
  [StorageClass.FLUX_COORDINATES]: 320n * MiB,
  [StorageClass.LOGS]: 48n * MiB,
};

export class StorageService {
  private derived = new Map<string, Partial<Record<StorageClass, bigint>>>();
  /** Checkpoints evicted per project, for Runs that finished. */
  private evictedCheckpoints = new Set<string>();

  constructor(private readonly store: MockStore) {}

  clear(): void {
    this.derived.clear();
    this.evictedCheckpoints.clear();
  }

  private held(projectId: string) {
    let held = this.derived.get(projectId);
    if (!held) {
      held = { ...INITIAL };
      this.derived.set(projectId, held);
    }
    return held;
  }

  usage(projectId: string): StorageUsage | undefined {
    if (!this.store.project(projectId)) return undefined;
    const held = this.held(projectId);
    const runs = this.store.runList(projectId);
    const results = runs
      .map((run) => ({ run, outputs: this.store.runOutputs(run.id).length }))
      .filter((r) => r.outputs > 0)
      .map(({ run, outputs }) => ({
        runId: run.id,
        runName: run.name,
        outputs,
        bytes: BigInt(outputs) * OUTPUT_BYTES,
      }));
    // Checkpoints are kept while a Run may resume (A§4.7).
    const finished = (state: RunState) =>
      state === RunState.COMPLETED ||
      state === RunState.CANCELLED ||
      state === RunState.DISCARDED;
    const checkpoints = runs.filter(
      (run) =>
        run.attempts.some((a) => a.hasCheckpoint) &&
        !this.evictedCheckpoints.has(run.id),
    );
    const views = BigInt(this.store.views.size()) * VIEW_PAYLOAD_BYTES;
    const categories = [
      {
        storageClass: StorageClass.PRIMARY,
        bytes: results.reduce((n, r) => n + r.bytes, 0n),
        evictable: false,
      },
      ...DERIVED.map((storageClass) => ({
        storageClass,
        bytes:
          storageClass === StorageClass.VIEW_PAYLOADS
            ? views
            : (held[storageClass] ?? 0n),
        evictable: true,
      })),
      {
        storageClass: StorageClass.CHECKPOINTS,
        bytes: BigInt(checkpoints.length) * CHECKPOINT_BYTES,
        // Only those of finished Runs (D141).
        evictable: checkpoints.some((run) => finished(run.state)),
      },
      {
        storageClass: StorageClass.LOGS,
        bytes: held[StorageClass.LOGS] ?? 0n,
        evictable: false,
      },
    ];
    return create(StorageUsageSchema, {
      capBytes: CAP,
      usedBytes: categories.reduce((n, c) => n + c.bytes, 0n),
      categories,
      results,
    });
  }

  /** Evicts derived artifacts and checkpoints of finished Runs. */
  evict(
    projectId: string,
    classes: readonly StorageClass[],
  ): StoreResult<bigint> {
    const before = this.usage(projectId);
    if (!before)
      return {
        ok: false,
        status: 404,
        code: "not_found",
        message: "Project not found",
      };
    const held = this.held(projectId);
    for (const storageClass of classes) {
      if ((DERIVED as readonly StorageClass[]).includes(storageClass)) {
        // Payloads are regenerated on demand (A§3.6).
        if (storageClass === StorageClass.VIEW_PAYLOADS)
          this.store.views.clear();
        else held[storageClass] = 0n;
      } else if (storageClass === StorageClass.CHECKPOINTS) {
        for (const run of this.store.runList(projectId)) {
          if (
            run.state === RunState.COMPLETED ||
            run.state === RunState.CANCELLED ||
            run.state === RunState.DISCARDED
          ) {
            this.evictedCheckpoints.add(run.id);
          }
        }
      } else {
        return {
          ok: false,
          status: 422,
          code: "invalid",
          message: `${StorageClass[storageClass]} cannot be evicted`,
        };
      }
    }
    return {
      ok: true,
      value: before.usedBytes - this.usage(projectId)!.usedBytes,
    };
  }

  /** Stored-output nodes that feed a Run's outputs, in drafts and versions. */
  dependents(projectId: string, runId: string): Dependent[] {
    const found: Dependent[] = [];
    for (const record of this.store.entityRecords(
      projectId,
      EntityKind.WORKFLOW,
    )) {
      const contents = [
        ["", record.draft.content] as const,
        ...Object.entries(record.versionContents ?? {}),
      ];
      for (const [hash, content] of contents) {
        const workflow = content && anyUnpack(content, WorkflowSchema);
        for (const node of workflow?.nodes ?? []) {
          if (
            node.kind.case === "storedOutput" &&
            node.kind.value.runId === runId
          ) {
            found.push(
              create(DependentSchema, {
                kind: EntityKind.WORKFLOW,
                id: record.draft.id,
                name: record.draft.name,
                path: `nodes/${node.id}`,
                versionHash: hash,
              }),
            );
          }
        }
      }
    }
    return found;
  }

  /**
   * Deletes the primary results of Runs. Their metadata stays (A§4.7). With
   * dependents, the request must acknowledge them (D141).
   */
  deleteResults(
    projectId: string,
    runIds: readonly string[],
    acknowledged: boolean,
  ): StoreResult<string[]> {
    const runs = runIds.map((id) => this.store.run(projectId, id));
    if (runs.some((run) => !run)) {
      return {
        ok: false,
        status: 404,
        code: "not_found",
        message: "Run not found",
      };
    }
    const dependents = runIds.flatMap((id) => this.dependents(projectId, id));
    if (dependents.length && !acknowledged) {
      return {
        ok: false,
        status: 409,
        code: "in_use",
        message: `Referenced by ${dependents.length} stored-output nodes`,
      };
    }
    this.store.engine.outputs = this.store.engine.outputs.filter(
      (o) => !runIds.includes(o.runId),
    );
    return { ok: true, value: [...runIds] };
  }
}
