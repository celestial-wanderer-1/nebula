import {
  create,
  type DescMessage,
  type Message,
  type MessageShape,
  type Registry,
} from "@bufbuild/protobuf";
import { anyPack, anyUnpack, type Any } from "@bufbuild/protobuf/wkt";
import { newMessage } from "../forms/defaults";
import {
  ComponentSchema,
  type Component,
} from "../gen/nebula/core/v1/component_pb";
import {
  GeometrySchema,
  type Geometry,
} from "../gen/nebula/core/v1/geometry_pb";

/** "type.googleapis.com/nebula.core.v1.Foo" -> "nebula.core.v1.Foo". */
export function typeNameOf(any: Any | undefined): string {
  const url = any?.typeUrl ?? "";
  return url.slice(url.lastIndexOf("/") + 1);
}

export interface UnpackedComponent {
  component: Component;
  /** Unset when the registry does not know the shape type. */
  shapeDesc?: DescMessage;
  shape?: Message;
  /** Full message name of the shape, known or not. */
  shapeType: string;
}

/**
 * The `Component` wrapper of COMPONENT draft content (A§4.1), without
 * resolving its shape. Content that is a bare shape (pre-wrapper data) is
 * wrapped, not lost.
 */
export function unwrapComponent(content: Any | undefined): Component {
  if (!content) return create(ComponentSchema);
  return (
    anyUnpack(content, ComponentSchema) ??
    create(ComponentSchema, { shape: content })
  );
}

/**
 * A component with its shape resolved through the plugin-aware registry. A
 * shape type the registry lacks keeps its bytes in `component.shape`, so
 * nothing is dropped.
 */
export function resolveShape(
  component: Component,
  registry: Registry,
): UnpackedComponent {
  const shapeType = typeNameOf(component.shape);
  const shapeDesc = shapeType ? registry.getMessage(shapeType) : undefined;
  const shape =
    component.shape && shapeDesc
      ? anyUnpack(component.shape, shapeDesc)
      : undefined;
  return { component, shapeDesc, shape, shapeType };
}

/** Unpacks COMPONENT draft content: the wrapper and its resolved shape. */
export function unpackComponent(
  content: Any | undefined,
  registry: Registry,
): UnpackedComponent {
  return resolveShape(unwrapComponent(content), registry);
}

export function packComponent(component: Component): Any {
  return anyPack(ComponentSchema, component);
}

/** The component with a new shape value, packed into `shape`. */
export function withShape<Desc extends DescMessage>(
  component: Component,
  desc: Desc,
  shape: MessageShape<Desc>,
): Component {
  return { ...component, shape: anyPack(desc, shape) };
}

/** Content of a new component of shape `desc`, at its defaults (D87). */
export function newComponent(desc: DescMessage): Any {
  return packComponent(
    withShape(create(ComponentSchema), desc, newMessage(desc)),
  );
}

/** GEOMETRY draft content; an empty Geometry when absent. */
export function unpackGeometry(content: Any | undefined): Geometry {
  return (
    (content && anyUnpack(content, GeometrySchema)) ?? create(GeometrySchema)
  );
}

export function packGeometry(geometry: Geometry): Any {
  return anyPack(GeometrySchema, geometry);
}

/** A stable circuit ID, generated once and stored in content (D114). */
export function newCircuitId(): string {
  return `ckt-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}
