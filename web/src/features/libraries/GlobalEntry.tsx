import { create } from "@bufbuild/protobuf";
import { useMemo, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { NotFoundError } from "../../api/errors";
import {
  useImportComponent,
  useImportMaterial,
  useLibraryComponent,
  useLibraryMaterial,
  useLibraryMaterials,
} from "../../api/library";
import { resolveShape } from "../../entities/content";
import { ConfigForm } from "../../forms/ConfigForm";
import { ComponentSchema } from "../../gen/nebula/core/v1/component_pb";
import { MaterialPropertiesSchema } from "../../gen/nebula/core/v1/material_pb";
import { useSchema } from "../../schema/context";
import { useShapeName } from "./hooks";
import {
  componentPath,
  globalMaterialPath,
  librariesPath,
  materialPath,
} from "./paths";

const ignore = () => undefined;

/** Frame of a read-only global library entry with Import (D88). */
function EntryView({
  projectId,
  tab,
  noun,
  query,
  importing,
  importError,
  onImport,
  children,
}: {
  projectId: string;
  tab: "global-components" | "global-materials";
  noun: string;
  query: {
    data?: { name: string; description: string };
    error: Error | null;
  };
  importing: boolean;
  importError: Error | null;
  onImport: () => void;
  children: ReactNode;
}) {
  const back = librariesPath(projectId, tab);
  if (query.error instanceof NotFoundError) {
    return (
      <section className="placeholder">
        <h1>Library entry not found</h1>
        <p>
          <Link to={back}>Back to libraries</Link>
        </p>
      </section>
    );
  }
  if (!query.data) {
    return <p className="muted">{query.error?.message ?? "Loading…"}</p>;
  }
  return (
    <section className="library-detail">
      <p className="eyebrow">
        <Link to={back}>Libraries</Link> / Global {noun}
      </p>
      <div className="page-header">
        <h1>{query.data.name}</h1>
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={importing}
            onClick={onImport}
          >
            Import into project
          </button>
        </div>
      </div>
      {query.data.description && <p>{query.data.description}</p>}
      {importError && (
        <p className="field-error" role="alert">
          Import failed: {importError.message}
        </p>
      )}
      {children}
    </section>
  );
}

/** A global component entry: its shape and material, read-only. */
export function GlobalComponentEntry() {
  const { projectId = "", entryId = "" } = useParams();
  const navigate = useNavigate();
  const { typeRegistry } = useSchema();
  const entry = useLibraryComponent(entryId);
  const materials = useLibraryMaterials();
  const importComponent = useImportComponent(projectId);
  const shapeName = useShapeName();

  const component = entry.data?.component;
  const { shapeDesc, shape, shapeType } = useMemo(
    () => resolveShape(component ?? create(ComponentSchema), typeRegistry),
    [component, typeRegistry],
  );
  const materialId = component?.materialId ?? "";
  const material = materials.data?.find((m) => m.id === materialId);

  return (
    <EntryView
      projectId={projectId}
      tab="global-components"
      noun="component"
      query={entry}
      importing={importComponent.isPending}
      importError={importComponent.error}
      onImport={() =>
        importComponent.mutate(entryId, {
          onSuccess: (draft) =>
            void navigate(componentPath(projectId, draft.id)),
        })
      }
    >
      <dl className="details">
        <dt>Shape</dt>
        <dd data-shape-type={shapeType}>{shapeName(shapeType)}</dd>
        <dt>Material</dt>
        <dd>
          {!materialId ? (
            "None"
          ) : material ? (
            <Link to={globalMaterialPath(projectId, material.id)}>
              {material.name}
            </Link>
          ) : (
            materialId
          )}
        </dd>
      </dl>
      {shapeDesc && shape ? (
        <ConfigForm
          schema={shapeDesc}
          value={shape}
          projectId={projectId}
          readOnly
          onChange={ignore}
        />
      ) : (
        shapeType && (
          <p className="field-warning" role="note">
            Shape type “{shapeType}” is not known to this UI (its plugin may be
            missing or disabled).
          </p>
        )
      )}
    </EntryView>
  );
}

/** A global material entry: its properties, read-only. */
export function GlobalMaterialEntry() {
  const { projectId = "", entryId = "" } = useParams();
  const navigate = useNavigate();
  const entry = useLibraryMaterial(entryId);
  const importMaterial = useImportMaterial(projectId);

  return (
    <EntryView
      projectId={projectId}
      tab="global-materials"
      noun="material"
      query={entry}
      importing={importMaterial.isPending}
      importError={importMaterial.error}
      onImport={() =>
        importMaterial.mutate(entryId, {
          onSuccess: (material) =>
            void navigate(materialPath(projectId, material.id)),
        })
      }
    >
      <h2>Properties</h2>
      <ConfigForm
        schema={MaterialPropertiesSchema}
        value={entry.data?.properties ?? create(MaterialPropertiesSchema)}
        projectId={projectId}
        readOnly
        onChange={ignore}
      />
    </EntryView>
  );
}
