import type { FieldViolation } from "../gen/nebula/core/v1/errors_pb";
import type { Quantity } from "../gen/nebula/core/v1/options_pb";

/**
 * Advisory bounds check from the `quantity` annotation (A§5.8). The server is
 * authoritative (A§13.1); this only gives fast feedback.
 */
export function boundsWarning(
  quantity: Quantity | undefined,
  value: number | bigint,
): string | undefined {
  if (!quantity) return undefined;
  const n = Number(value);
  if (quantity.min !== undefined && n < quantity.min) {
    return `Below the minimum of ${quantity.min}`;
  }
  if (quantity.max !== undefined && n > quantity.max) {
    return `Above the maximum of ${quantity.max}`;
  }
  return undefined;
}

/** Text such as "0 to 3", "≥ 0" or "" for the bounds of a quantity. */
export function boundsHint(quantity: Quantity | undefined): string {
  const min = quantity?.min;
  const max = quantity?.max;
  if (min !== undefined && max !== undefined) return `${min} to ${max}`;
  if (min !== undefined) return `≥ ${min}`;
  if (max !== undefined) return `≤ ${max}`;
  return "";
}

/** Server violations attached exactly to a field path, such as `grid.nr`. */
export function violationsAt(
  violations: readonly FieldViolation[],
  path: string,
): string[] {
  return violations
    .filter((violation) => violation.path === path)
    .map((violation) => violation.message);
}

export function joinPath(prefix: string, name: string): string {
  return prefix ? `${prefix}.${name}` : name;
}
