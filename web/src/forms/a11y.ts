import { useFormContext } from "./context";
import { violationsAt } from "./validate";

/** aria-describedby / aria-invalid for a control inside `FieldShell`. */
export function useFieldA11y(id: string, path: string, help: boolean) {
  const { violations } = useFormContext();
  return {
    "aria-describedby": help ? `${id}-help` : undefined,
    "aria-invalid": violationsAt(violations, path).length > 0 || undefined,
  };
}
