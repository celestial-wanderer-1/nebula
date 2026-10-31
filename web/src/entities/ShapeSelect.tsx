import { usePlugins } from "../api/plugins";
import { ExtensionKind } from "../gen/nebula/core/v1/plugin_pb";
import { useSchema } from "../schema/context";

/**
 * Picks the shape type of a new component among the plugins'
 * GEOMETRY_COMPONENT extensions (A§10.1), grouped by plugin. A shape whose
 * plugin schema is missing cannot be chosen.
 */
export function ShapeSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  /** Full message name of the shape type; "" for none yet. */
  value: string;
  onChange: (shapeType: string) => void;
}) {
  const plugins = usePlugins();
  const { typeRegistry } = useSchema();
  const groups = (plugins.data ?? [])
    .map((plugin) => ({
      plugin: plugin.id,
      shapes: plugin.extensions.filter(
        (extension) => extension.kind === ExtensionKind.GEOMETRY_COMPONENT,
      ),
    }))
    .filter((group) => group.shapes.length > 0);
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled>
          {plugins.isPending ? "Loading…" : "Choose a shape"}
        </option>
        {groups.map((group) => (
          <optgroup key={group.plugin} label={group.plugin}>
            {group.shapes.map((shape) => (
              <option
                key={shape.id}
                value={shape.configMessage}
                disabled={!typeRegistry.getMessage(shape.configMessage)}
              >
                {shape.displayName || shape.configMessage}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {plugins.error && (
        <p className="field-error" role="alert">
          {plugins.error.message}
        </p>
      )}
    </>
  );
}
