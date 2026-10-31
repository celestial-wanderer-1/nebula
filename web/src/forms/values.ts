import { ScalarType, type DescField } from "@bufbuild/protobuf";

const LONG_TYPES = new Set([
  ScalarType.INT64,
  ScalarType.UINT64,
  ScalarType.FIXED64,
  ScalarType.SFIXED64,
  ScalarType.SINT64,
]);
const UNSIGNED_TYPES = new Set([
  ScalarType.UINT32,
  ScalarType.UINT64,
  ScalarType.FIXED32,
  ScalarType.FIXED64,
]);
const FLOAT_TYPES = new Set([ScalarType.DOUBLE, ScalarType.FLOAT]);

export type NumericValue = number | bigint | string;

export interface NumericKind {
  integer: boolean;
  unsigned: boolean;
  /** 64-bit: bigint, or string when the field uses `jstype = JS_STRING`. */
  long: "bigint" | "string" | false;
}

export function isNumericScalar(scalar: ScalarType): boolean {
  return (
    scalar !== ScalarType.BOOL &&
    scalar !== ScalarType.STRING &&
    scalar !== ScalarType.BYTES
  );
}

export function numericKind(
  scalar: ScalarType,
  field?: DescField,
): NumericKind {
  const longAsString =
    field && "longAsString" in field ? Boolean(field.longAsString) : false;
  return {
    integer: !FLOAT_TYPES.has(scalar),
    unsigned: UNSIGNED_TYPES.has(scalar),
    long: LONG_TYPES.has(scalar) ? (longAsString ? "string" : "bigint") : false,
  };
}

export type Parsed =
  { ok: true; value: NumericValue } | { ok: false; error: string };

/**
 * The range of an integer kind on the wire. The binary writer throws on any
 * other value, and every content edit is packed into an Any at once.
 */
function integerRange(kind: NumericKind): readonly [bigint, bigint] {
  const bits = kind.long ? 64n : 32n;
  return kind.unsigned
    ? [0n, (1n << bits) - 1n]
    : [-(1n << (bits - 1n)), (1n << (bits - 1n)) - 1n];
}

function outOfRange(value: bigint, kind: NumericKind): string | undefined {
  const [min, max] = integerRange(kind);
  if (value < min) return `Must be at least ${min}`;
  if (value > max) return `Must be at most ${max}`;
  return undefined;
}

/** Parses user text into the field's JavaScript representation. */
export function parseNumber(text: string, kind: NumericKind): Parsed {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: "Enter a number" };
  if (kind.long) {
    let value: bigint;
    try {
      value = BigInt(trimmed);
    } catch {
      return { ok: false, error: "Enter a whole number" };
    }
    if (kind.unsigned && value < 0n) {
      return { ok: false, error: "Must not be negative" };
    }
    const range = outOfRange(value, kind);
    if (range) return { ok: false, error: range };
    return {
      ok: true,
      value: kind.long === "string" ? value.toString() : value,
    };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, error: "Enter a number" };
  if (kind.integer && !Number.isInteger(value)) {
    return { ok: false, error: "Enter a whole number" };
  }
  if (kind.unsigned && value < 0) {
    return { ok: false, error: "Must not be negative" };
  }
  if (kind.integer) {
    const range = outOfRange(BigInt(value), kind);
    if (range) return { ok: false, error: range };
  }
  return { ok: true, value };
}

export function formatNumber(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

export function zeroValue(scalar: ScalarType, field?: DescField): unknown {
  if (scalar === ScalarType.BOOL) return false;
  if (scalar === ScalarType.STRING) return "";
  if (scalar === ScalarType.BYTES) return new Uint8Array();
  const kind = numericKind(scalar, field);
  if (kind.long === "bigint") return 0n;
  if (kind.long === "string") return "0";
  return 0;
}

/** Well-known types have special JSON forms; they are shown, not edited. */
export function isWellKnown(typeName: string): boolean {
  return typeName.startsWith("google.protobuf.");
}
