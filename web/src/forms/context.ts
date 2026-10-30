import { createContext, useContext } from "react";
import type { FieldViolation } from "../gen/nebula/core/v1/errors_pb";

export interface FormContextValue {
  /** Project whose entities reference pickers list. */
  projectId?: string;
  readOnly: boolean;
  violations: readonly FieldViolation[];
}

export const FormContext = createContext<FormContextValue>({
  readOnly: false,
  violations: [],
});

export function useFormContext(): FormContextValue {
  return useContext(FormContext);
}
