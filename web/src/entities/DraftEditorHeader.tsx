import { useId, type ReactNode } from "react";
import { ValidationError } from "../api/errors";
import { ConflictDialog } from "./ConflictDialog";
import { DraftViolations, SaveStatus } from "./SaveStatus";
import type { DraftState } from "./useDraft";

/**
 * Name field, save status and server errors of a draft editor, with the
 * conflict dialog (D148). `inline` lists violation path prefixes the
 * editor's own fields show; the rest are listed here, so a rejected save
 * always says why (docs/UI.md Section 5).
 */
export function DraftEditorHeader({
  draft,
  label,
  inline = [],
  describe,
  children,
}: {
  draft: DraftState;
  /** Label of the name field, such as "Region name". */
  label: string;
  inline?: readonly string[];
  describe?: (path: string) => string;
  children?: ReactNode;
}) {
  const ids = useId();
  const violations =
    draft.error instanceof ValidationError ? draft.error.violations : [];
  const nameError = violations.find((v) => v.path === "name")?.message;
  const other = violations.filter(
    (v) =>
      v.path !== "name" &&
      !inline.some(
        (prefix) => v.path === prefix || v.path.startsWith(`${prefix}.`),
      ),
  );
  return (
    <>
      <div className="draft-header" role="group" aria-label="Draft">
        <div className="field">
          <label htmlFor={`${ids}-name`}>{label}</label>
          <input
            id={`${ids}-name`}
            value={draft.name}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${ids}-name-error` : undefined}
            onChange={(event) => draft.setName(event.target.value)}
          />
          {nameError && (
            <p className="field-error" id={`${ids}-name-error`}>
              {nameError}
            </p>
          )}
        </div>
        <SaveStatus status={draft.status} />
        {children}
      </div>
      {draft.error && !(draft.error instanceof ValidationError) && (
        <p className="field-error" role="alert">
          {draft.error.message}
        </p>
      )}
      <DraftViolations violations={other} describe={describe} />
      <ConflictDialog
        conflict={draft.conflict}
        onResolve={draft.resolveConflict}
      />
    </>
  );
}
