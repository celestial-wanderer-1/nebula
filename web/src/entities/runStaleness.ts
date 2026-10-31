import type { EntitySummary } from "../gen/nebula/core/v1/entity_pb";
import type { PinnedInput, Run } from "../gen/nebula/core/v1/run_pb";

/**
 * The inputs a Run pinned whose head version has since moved (A§4.4,
 * D101). Draft edits alone do not make a Run stale.
 */
export function staleInputs(
  run: Run,
  summaries: readonly EntitySummary[],
): PinnedInput[] {
  const heads = new Map(
    summaries.map((s) => [`${s.kind}/${s.id}`, s.headHash]),
  );
  return (run.provenance?.inputs ?? []).filter((input) => {
    const head = heads.get(`${input.kind}/${input.id}`);
    return Boolean(head) && head !== input.versionHash;
  });
}
