import type { Extension } from "../../gen/nebula/core/v1/plugin_pb";
import { stepKindOf } from "../../workflow/ports";

/** The node kinds of A§13.4 that do not run an extension. */
export type CoreKind = "coupled" | "fanOut" | "storedOutput" | "inputDataset";

const CORE_NODES: { kind: CoreKind; label: string; help: string }[] = [
  {
    kind: "storedOutput",
    label: "Stored output",
    help: "A committed output of an earlier run (D22).",
  },
  {
    kind: "inputDataset",
    label: "Input dataset",
    help: "An ingested HDF5 dataset (D144).",
  },
  {
    kind: "coupled",
    label: "Coupled",
    help: "Iterates its steps to a fixed point (D49).",
  },
  {
    kind: "fanOut",
    label: "Fan-out",
    help: "Maps its steps over time slices (D92).",
  },
];

/**
 * The extension palette (docs/UI.md 6.5): workflow extensions from
 * `/plugins`, grouped by calculation type, plus the core node kinds.
 * Buttons, so nodes can be added by keyboard.
 */
export function Palette({
  extensions,
  onAddExtension,
  onAddCore,
  disabled,
}: {
  extensions: readonly Extension[];
  onAddExtension: (extension: Extension) => void;
  onAddCore: (kind: CoreKind) => void;
  disabled?: boolean;
}) {
  const groups = new Map<string, Extension[]>();
  for (const extension of extensions) {
    if (!stepKindOf(extension)) continue;
    const key = extension.calculationType || "other";
    groups.set(key, [...(groups.get(key) ?? []), extension]);
  }
  return (
    <nav className="palette" aria-label="Palette">
      <h2>Add a step</h2>
      {[...groups].map(([type, members]) => (
        <section key={type} aria-label={type}>
          <h3>{type}</h3>
          <ul>
            {members.map((extension) => (
              <li key={extension.id}>
                <button
                  type="button"
                  className="palette-item"
                  disabled={disabled}
                  title={extension.id}
                  onClick={() => onAddExtension(extension)}
                >
                  {extension.displayName}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section aria-label="Core nodes">
        <h3>core</h3>
        <ul>
          {CORE_NODES.map((core) => (
            <li key={core.kind}>
              <button
                type="button"
                className="palette-item"
                disabled={disabled}
                title={core.help}
                onClick={() => onAddCore(core.kind)}
              >
                {core.label}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </nav>
  );
}
