import { Link } from "react-router";
import { useLibraryComponents, useLibraryMaterials } from "../api/library";
import type { LibrarySource } from "../gen/nebula/core/v1/entity_pb";
import { formatTime } from "./format";

/**
 * The provenance link of a project copy to its global library entry (D88).
 * The copy is independent: it stays valid when the entry is gone.
 */
export function LibrarySourceLink({
  projectId,
  source,
  kind,
}: {
  projectId: string;
  source: LibrarySource | undefined;
  kind: "component" | "material";
}) {
  const components = useLibraryComponents({
    enabled: Boolean(source) && kind === "component",
  });
  const materials = useLibraryMaterials({
    enabled: Boolean(source) && kind === "material",
  });
  if (!source) return null;

  const entries = kind === "component" ? components.data : materials.data;
  // Until the library has loaded, assume the entry still exists.
  const gone = entries?.every((entry) => entry.id !== source.entryId) ?? false;
  const name = source.entryName || source.entryId;
  const importedAt = source.importedAt && formatTime(source.importedAt);

  return (
    <p className="muted">
      Imported from library entry{" "}
      {gone ? (
        <>“{name}” (no longer in the library)</>
      ) : (
        <Link
          to={`/p/${encodeURIComponent(projectId)}/libraries/global/${kind}s/${encodeURIComponent(source.entryId)}`}
        >
          “{name}”
        </Link>
      )}
      {importedAt && <> on {importedAt}</>}
    </p>
  );
}
