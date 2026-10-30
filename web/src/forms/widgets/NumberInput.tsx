import { useState, type InputHTMLAttributes } from "react";
import {
  formatNumber,
  parseNumber,
  type NumericKind,
  type NumericValue,
} from "../values";

/**
 * A number input that keeps the user's text while it does not parse yet
 * ("1e-", "-"), and reports values only once they parse.
 */
export function NumberInput({
  value,
  kind,
  onChange,
  onParseError,
  ...rest
}: {
  value: NumericValue;
  kind: NumericKind;
  onChange: (value: NumericValue) => void;
  onParseError?: (error: string | undefined) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(formatNumber(value));
  const [shown, setShown] = useState(value);
  // Follow external changes unless the text already denotes the new value.
  if (shown !== value) {
    setShown(value);
    const parsed = parseNumber(text, kind);
    if (!parsed.ok || parsed.value !== value) setText(formatNumber(value));
  }
  return (
    <input
      {...rest}
      type="text"
      inputMode={kind.integer ? "numeric" : "decimal"}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = parseNumber(event.target.value, kind);
        if (parsed.ok) {
          onParseError?.(undefined);
          setShown(parsed.value);
          onChange(parsed.value);
        } else {
          onParseError?.(parsed.error);
        }
      }}
    />
  );
}
