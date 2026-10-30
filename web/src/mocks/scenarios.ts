import { create } from "@bufbuild/protobuf";
import { anyPack, anyUnpack } from "@bufbuild/protobuf/wkt";
import { CircularFilamentSchema } from "../gen/nebula/core/v1/component_pb";
import type { EntityKind } from "../gen/nebula/core/v1/entity_pb";
import { QueueSummarySchema } from "../gen/nebula/core/v1/queue_pb";
import { store } from "./state";

/**
 * Scripted situations for tests and manual checks (docs/UI.md Section 7).
 * Run phases (P4) add their flows here.
 */
export const scenarios = {
  /** The server reports an API version this UI does not speak. */
  versionMismatch(): void {
    store.apiVersion = "0";
  },

  /**
   * An edit by "another client", for example the SDK: bumps the draft
   * revision and publishes the change (D148).
   */
  concurrentEdit(projectId: string, kind: EntityKind, id: string): void {
    const record = store.entity(projectId, kind, id);
    if (!record) throw new Error(`No entity ${projectId}/${kind}/${id}`);
    let content = record.draft.content;
    const filament = content && anyUnpack(content, CircularFilamentSchema);
    if (filament) {
      content = anyPack(
        CircularFilamentSchema,
        create(CircularFilamentSchema, {
          ...filament,
          turns: filament.turns + 1,
        }),
      );
    }
    store.updateDraft(record, record.draft.revision, {
      name: `${record.draft.name} (edited elsewhere)`,
      content,
    });
  },

  /** Changes the queue counts, as a submitted or finished Run would. */
  setQueue(queued: number, running: number): void {
    store.setQueue(
      create(QueueSummarySchema, { ...store.queue, queued, running }),
    );
  },
};

/** Applies a scenario named in a mock build's URL fragment. */
export function applyNamedScenario(name: string | null): void {
  if (name === "version-mismatch") scenarios.versionMismatch();
}
