import {
  create,
  getExtension,
  hasExtension,
  type DescEnumValue,
  type DescField,
  type DescMessage,
} from "@bufbuild/protobuf";
import {
  component,
  ComponentTraitsSchema,
  file_nebula_core_v1_options,
  label,
  quantity,
  role,
  tolerance,
  ui,
  UiHintSchema,
  type ComponentTraits,
  type Quantity,
  type Tolerance,
  type UiHint,
} from "../gen/nebula/core/v1/options_pb";

// Core options occupy 50000-50999 (options.proto).
const CORE_OPTION_MIN = 50000;
const CORE_OPTION_MAX = 50999;
// Every field option this build's core declares, so adding one to
// options.proto never turns the fields that carry it read-only.
const KNOWN_FIELD_OPTIONS = new Set(
  file_nebula_core_v1_options.extensions
    .filter((ext) => ext.extendee.typeName === "google.protobuf.FieldOptions")
    .map((ext) => ext.number),
);

const emptyHint = create(UiHintSchema);
const emptyTraits = create(ComponentTraitsSchema);

/** Unit tag and bounds of a numeric field (A§5.8), when annotated. */
export function quantityOf(field: DescField): Quantity | undefined {
  const options = field.proto.options;
  return options && hasExtension(options, quantity)
    ? getExtension(options, quantity)
    : undefined;
}

/** Declared tolerance of an output quantity (D43), when annotated. */
export function toleranceOf(field: DescField): Tolerance | undefined {
  const options = field.proto.options;
  return options && hasExtension(options, tolerance)
    ? getExtension(options, tolerance)
    : undefined;
}

/**
 * Whether two values agree under a tolerance (D43): within `abs`, or within
 * `rel` of the larger magnitude. Without a tolerance they must be equal.
 */
export function withinTolerance(
  a: number,
  b: number,
  declared: Tolerance | undefined,
): boolean {
  const diff = Math.abs(a - b);
  if (diff === 0) return true;
  const absOk = declared?.abs !== undefined && diff <= declared.abs;
  const relOk =
    declared?.rel !== undefined &&
    diff <= declared.rel * Math.max(Math.abs(a), Math.abs(b));
  return absOk || relOk;
}

/** UI hints of a field (D87); an empty hint when not annotated. */
export function uiHintOf(field: DescField): UiHint {
  const options = field.proto.options;
  return options && hasExtension(options, ui)
    ? getExtension(options, ui)
    : emptyHint;
}

/**
 * Traits of a component shape message: whether it carries current and
 * whether it is a filament. Circuits and the closure check read them (D114,
 * D145). Empty traits when not annotated.
 */
export function componentTraitsOf(desc: DescMessage): ComponentTraits {
  const options = desc.proto.options;
  return options && hasExtension(options, component)
    ? getExtension(options, component)
    : emptyTraits;
}

/** The role a message plays in Any fields, such as "plasma_target". */
export function roleOf(desc: DescMessage): string {
  const options = desc.proto.options;
  return options && hasExtension(options, role)
    ? getExtension(options, role)
    : "";
}

/**
 * Core option numbers on a field that this UI build does not know. Such a
 * field comes from a newer core and is rendered read-only (Section 5).
 */
export function unknownCoreOptions(field: DescField): number[] {
  return (field.proto.options?.$unknown ?? [])
    .map((unknown) => unknown.no)
    .filter(
      (no) =>
        no >= CORE_OPTION_MIN &&
        no <= CORE_OPTION_MAX &&
        !KNOWN_FIELD_OPTIONS.has(no),
    );
}

/** "edge_temperature" -> "Edge temperature". */
export function humanize(name: string): string {
  const words = name.replace(/_/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function fieldLabel(field: DescField): string {
  return uiHintOf(field).label || humanize(field.name);
}

/** Display label of an enum value: its `label` option, else its name. */
export function enumValueLabel(value: DescEnumValue): string {
  const options = value.proto.options;
  if (options && hasExtension(options, label)) {
    return getExtension(options, label);
  }
  return humanize(value.localName);
}

/**
 * A readable name of a message type: "PlasmaTargets" -> "Plasma targets",
 * with the package for plugin types, so same-named types stay apart.
 */
export function messageLabel(desc: DescMessage): string {
  const words = desc.name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const name = humanize(words);
  const pkg = desc.file.proto.package;
  return pkg.startsWith("nebula.core.") ? name : `${name} (${pkg})`;
}
