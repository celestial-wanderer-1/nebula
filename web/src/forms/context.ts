import { createContext, useContext } from "react";
import type { FieldViolation } from "../gen/nebula/core/v1/errors_pb";
import type { IdRef } from "../gen/nebula/core/v1/options_pb";

/** One choice of an ID field: a stable ID and what the user sees. */
export interface IdChoice {
  id: string;
  label: string;
}

/** IDs the editing context offers per kind (`ui.id_ref`). */
export type IdChoices = Partial<Record<IdRef, readonly IdChoice[]>>;

export interface FormContextValue {
  /** Project whose entities reference pickers list. */
  projectId?: string;
  readOnly: boolean;
  violations: readonly FieldViolation[];
  /** For ID fields, such as the circuits of the referenced geometry. */
  idChoices?: IdChoices;
}

export const FormContext = createContext<FormContextValue>({
  readOnly: false,
  violations: [],
});

export function useFormContext(): FormContextValue {
  return useContext(FormContext);
}
