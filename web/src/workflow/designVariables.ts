import type { DescField, DescMessage, Registry } from "@bufbuild/protobuf";
import { anyUnpack, type Any } from "@bufbuild/protobuf/wkt";
import {
  typeNameOf,
  unwrapComponent,
  unpackAs,
  unpackGeometry,
} from "../entities/content";
import type { EntityRef } from "../gen/nebula/core/v1/entity_pb";
import { ScenarioSchema } from "../gen/nebula/core/v1/scenario_pb";
import type { Workflow } from "../gen/nebula/core/v1/workflow_pb";
import { fieldLabel, messageLabel, quantityOf } from "../schema/annotations";
import { stepOf } from "./ports";

// Design variables a scan can vary (D81, A§12.1): annotated fields of the
// workflow's step configs and of the entities its steps are bound to.

export interface DesignVariable {
  /** Override path, the key of a ParameterOverride (D109). */
  path: string;
  label: string;
  unit: string;
  /** Value in the base version. */
  value: number;
  min?: number;
  max?: number;
}

/** Design-variable fields of a message, with their paths and values. */
function fieldsOf(
  desc: DescMessage,
  message: Record<string, unknown>,
  prefix: string,
  label: string,
): DesignVariable[] {
  return desc.fields.flatMap((field: DescField) => {
    const quantity = quantityOf(field);
    if (field.fieldKind !== "scalar" || !quantity?.designVariable) return [];
    return [
      {
        path: `${prefix}/${field.name}`,
        label: `${label}: ${fieldLabel(field)}`,
        unit: quantity.unit,
        value: Number(message[field.localName] ?? 0),
        min: quantity.min,
        max: quantity.max,
      },
    ];
  });
}

function unpacked(any: Any | undefined, registry: Registry) {
  const desc = any && registry.getMessage(typeNameOf(any));
  const message = desc && any ? anyUnpack(any, desc) : undefined;
  return desc && message
    ? { desc, message: message as unknown as Record<string, unknown> }
    : undefined;
}

/**
 * The design variables of a workflow version: step configs, the currents
 * and plasma targets of bound scenarios, and the shape parameters of the
 * components of bound geometries. `resolve` gives an entity's content as a
 * reference resolves it.
 */
export function designVariables(
  workflow: Workflow,
  resolve: (ref: EntityRef) => Any | undefined,
  registry: Registry,
  names: ReadonlyMap<string, string> = new Map(),
): DesignVariable[] {
  const found = new Map<string, DesignVariable>();
  const add = (variables: DesignVariable[]) =>
    variables.forEach((v) => found.set(v.path, v));
  for (const node of workflow.nodes) {
    const step = stepOf(node);
    if (!step) continue;
    const config = unpacked(step.config, registry);
    if (config) {
      add(
        fieldsOf(
          config.desc,
          config.message,
          `nodes/${node.id}/config`,
          node.label || node.id,
        ),
      );
    }
    for (const binding of step.bindings) {
      const ref = binding.ref;
      const content = ref && resolve(ref);
      if (!ref || !content) continue;
      if (binding.port === "scenario") {
        const scenario = unpackAs(ScenarioSchema, content);
        for (const current of scenario.currents) {
          add([
            {
              path: `scenarios/${ref.id}/currents/${current.circuitId}/current`,
              label: `Current of ${names.get(current.circuitId) ?? current.circuitId}`,
              unit: "A",
              value: current.current,
            },
          ]);
        }
        scenario.plasmaTargets.forEach((target, i) => {
          const held = unpacked(target, registry);
          if (held) {
            add(
              fieldsOf(
                held.desc,
                held.message,
                `scenarios/${ref.id}/plasma_targets/${i}`,
                messageLabel(held.desc),
              ),
            );
          }
        });
      }
      if (binding.port === "geometry") {
        for (const componentRef of unpackGeometry(content).components) {
          const component = resolve(componentRef);
          const shape =
            component && unpacked(unwrapComponent(component).shape, registry);
          if (shape) {
            add(
              fieldsOf(
                shape.desc,
                shape.message,
                `components/${componentRef.id}/shape`,
                names.get(componentRef.id) ?? componentRef.id,
              ),
            );
          }
        }
      }
    }
  }
  return [...found.values()];
}
