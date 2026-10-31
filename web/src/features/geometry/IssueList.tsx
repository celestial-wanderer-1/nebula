import {
  IssueSeverity,
  type ValidationIssue,
} from "../../gen/nebula/core/v1/project_pb";
import { worstSeverity } from "./issues";

/** Issues of one part of the geometry, inline in the property panel. */
export function IssueList({
  issues,
  label,
}: {
  issues: readonly ValidationIssue[];
  label: string;
}) {
  if (issues.length === 0) return null;
  return (
    <ul className="issues" aria-label={label}>
      {issues.map((issue, index) => (
        <li
          key={index}
          className={
            issue.severity === IssueSeverity.ERROR
              ? "issue issue-error"
              : "issue issue-warning"
          }
        >
          <strong>
            {issue.severity === IssueSeverity.ERROR ? "Error" : "Warning"}
          </strong>
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A marker in the assembly tree: error when the build failed or a check
 * errs, else warning. Nothing when all is well.
 */
export function IssueMarker({
  issues,
  buildError,
}: {
  issues: readonly ValidationIssue[];
  buildError?: string;
}) {
  const severity = buildError ? IssueSeverity.ERROR : worstSeverity(issues);
  if (severity === undefined) return null;
  const error = severity === IssueSeverity.ERROR;
  const details = [buildError, ...issues.map((issue) => issue.message)]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      className={error ? "tree-marker marker-error" : "tree-marker marker-warn"}
      role="img"
      aria-label={error ? "Has errors" : "Has warnings"}
      title={details}
    >
      {error ? "✕" : "!"}
    </span>
  );
}
