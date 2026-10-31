import { anyUnpack, type Any } from "@bufbuild/protobuf/wkt";
import { typeNameOf } from "../entities/content";
import { Quantity } from "../entities/Quantity";
import { fieldLabel, quantityOf } from "../schema/annotations";
import { useSchema } from "../schema/context";

/** The values of a scalars output, with units from its schema (D46). */
export function ScalarsTable({
  scalars,
  label,
}: {
  scalars: Any | undefined;
  label: string;
}) {
  const schema = useSchema();
  const desc = scalars && schema.getMessage(typeNameOf(scalars));
  const message = desc && scalars ? anyUnpack(scalars, desc) : undefined;
  if (!desc || !message) {
    return <p className="muted small">No scalar values.</p>;
  }
  const values = message as unknown as Record<string, unknown>;
  return (
    <table className="table" aria-label={label}>
      <thead>
        <tr>
          <th scope="col">Quantity</th>
          <th scope="col">Value</th>
        </tr>
      </thead>
      <tbody>
        {desc.fields
          .filter((field) => field.fieldKind === "scalar")
          .map((field) => (
            <tr key={field.name}>
              <th scope="row">{fieldLabel(field)}</th>
              <td>
                <Quantity
                  value={Number(values[field.localName] ?? 0)}
                  unit={quantityOf(field)?.unit}
                />
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
