/**
 * A number with its unit label from the schema (D46). Values are SI as
 * stored; the UI never converts them.
 */
export function Quantity({
  value,
  unit,
}: {
  value: number | bigint;
  unit?: string;
}) {
  const text =
    typeof value === "bigint"
      ? value.toString()
      : Number.isInteger(value) || Math.abs(value) >= 1e-3
        ? value.toLocaleString("en", { maximumSignificantDigits: 8 })
        : value.toExponential();
  return (
    <span className="quantity">
      {text}
      {unit ? <span className="unit"> {unit}</span> : null}
    </span>
  );
}
