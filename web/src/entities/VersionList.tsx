import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { useQuery } from "@tanstack/react-query";
import { useId, type ReactNode } from "react";
import { Link } from "react-router";
import { draftQueryOptions, useVersions } from "../api/entities";
import {
  MintedBy,
  type EntityDraft,
  type EntityKind,
  type VersionMeta,
} from "../gen/nebula/core/v1/entity_pb";
import { formatTime } from "./format";
import { shortHash } from "./references";

const MINTED_BY: Readonly<Record<MintedBy, string>> = {
  [MintedBy.UNSPECIFIED]: "Unknown origin",
  [MintedBy.RUN_SUBMISSION]: "Run submission",
  [MintedBy.PROMOTION]: "Promotion",
  [MintedBy.SOLVED_SCENARIO]: "Solved scenario",
};

const millis = (time: Timestamp | undefined) =>
  time ? timestampDate(time).getTime() : 0;

/** Compares the draft with the head version it was last minted from. */
function draftState(
  draft: EntityDraft | undefined,
  head: VersionMeta | undefined,
  headHash: string,
): { state: "unversioned" | "changed" | "matches"; text: string } {
  if (!headHash) {
    return {
      state: "unversioned",
      text: "Never versioned: the draft is minted at the next run submission",
    };
  }
  if (draft && head && draft.revision > head.draftRevision) {
    return {
      state: "changed",
      text: `Draft changed since head version ${shortHash(headHash)}`,
    };
  }
  return {
    state: "matches",
    text: `Draft matches head version ${shortHash(headHash)}`,
  };
}

/**
 * Versions of an entity, newest first, with a draft-vs-head indicator
 * (A§4.2). `actions` adds per-version controls, such as a STEP export.
 */
export function VersionList({
  projectId,
  kind,
  id,
  draft,
  actions,
}: {
  projectId: string;
  kind: EntityKind;
  id: string;
  draft?: EntityDraft;
  actions?: (version: VersionMeta) => ReactNode;
}) {
  const headingId = useId();
  const versions = useVersions(projectId, kind, id);
  // Same query as useDraft, for callers that do not hold the draft.
  const fetched = useQuery({
    ...draftQueryOptions(projectId, kind, id),
    enabled: !draft,
  });
  const current = draft ?? fetched.data;

  const headHash = versions.data?.headHash ?? "";
  const list = [...(versions.data?.versions ?? [])].sort(
    (a, b) => millis(b.mintedAt) - millis(a.mintedAt),
  );
  const head = list.find((version) => version.hash === headHash);
  const indicator = draftState(current, head, headHash);

  return (
    <section className="version-list" aria-labelledby={headingId}>
      <h2 id={headingId}>Versions</h2>
      {versions.isPending && <p className="muted">Loading versions…</p>}
      {versions.error && (
        <p className="field-error" role="alert">
          {versions.error.message}
        </p>
      )}
      {versions.data && (
        <>
          <p
            className="draft-state"
            role="status"
            aria-label="Draft state"
            data-state={indicator.state}
          >
            {indicator.text}
          </p>
          {list.length > 0 && (
            <ol className="versions">
              {list.map((version) => (
                <li key={version.hash}>
                  <code title={version.hash}>{shortHash(version.hash)}</code>{" "}
                  <span>{MINTED_BY[version.mintedBy] ?? "Unknown origin"}</span>
                  {version.sourceId && (
                    <span className="muted">
                      {" "}
                      (
                      <Link
                        to={`/p/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(version.sourceId)}`}
                      >
                        {version.sourceId}
                      </Link>
                      )
                    </span>
                  )}{" "}
                  <span className="muted">{formatTime(version.mintedAt)}</span>
                  {version.hash === headHash && (
                    <>
                      {" "}
                      <span className="badge badge-info">head</span>
                    </>
                  )}
                  {actions && (
                    <span className="row-actions">{actions(version)}</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
