import type { ReactNode } from "react";
import { useFormContext } from "./context";
import { violationsAt } from "./validate";

/** Label, unit, help, warnings and server errors around one control. */
export function FieldShell({
  id,
  path,
  label,
  unit,
  designVariable,
  help,
  hint,
  warning,
  labelElement = "label",
  children,
}: {
  id: string;
  /** "span" for controls a <label> cannot label; they use aria-labelledby. */
  labelElement?: "label" | "span";
  path: string;
  label: string;
  unit?: string;
  designVariable?: boolean;
  help?: string;
  hint?: string;
  warning?: string;
  children: ReactNode;
}) {
  const { violations } = useFormContext();
  const errors = violationsAt(violations, path);
  const text = (
    <>
      {label}
      {unit && <span className="unit"> [{unit}]</span>}
      {designVariable && (
        <span className="badge badge-dv" title="Design variable (D81)">
          DV
        </span>
      )}
    </>
  );
  return (
    <div className="field" data-path={path}>
      {labelElement === "label" ? (
        <label htmlFor={id}>{text}</label>
      ) : (
        <span className="field-label" id={`${id}-label`}>
          {text}
        </span>
      )}
      {children}
      {(help || hint) && (
        <p className="field-help" id={`${id}-help`}>
          {[help, hint && `Range: ${hint}`].filter(Boolean).join(" · ")}
        </p>
      )}
      {warning && (
        <p className="field-warning" role="status">
          {warning}
        </p>
      )}
      {errors.map((message) => (
        <p key={message} className="field-error" role="alert">
          {message}
        </p>
      ))}
    </div>
  );
}
