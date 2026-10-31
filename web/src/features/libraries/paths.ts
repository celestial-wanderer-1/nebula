// Routes of the libraries area under /p/:projectId (docs/UI.md Section 6.2).

export type LibraryTab =
  "components" | "materials" | "global-components" | "global-materials";

export const LIBRARY_TABS: readonly LibraryTab[] = [
  "components",
  "materials",
  "global-components",
  "global-materials",
];

const base = (projectId: string) =>
  `/p/${encodeURIComponent(projectId)}/libraries`;

export function librariesPath(projectId: string, tab?: LibraryTab): string {
  return tab ? `${base(projectId)}?tab=${tab}` : base(projectId);
}

export function componentPath(projectId: string, id: string): string {
  return `${base(projectId)}/components/${encodeURIComponent(id)}`;
}

export function materialPath(projectId: string, id: string): string {
  return `${base(projectId)}/materials/${encodeURIComponent(id)}`;
}

export function globalComponentPath(projectId: string, id: string): string {
  return `${base(projectId)}/global/components/${encodeURIComponent(id)}`;
}

export function globalMaterialPath(projectId: string, id: string): string {
  return `${base(projectId)}/global/materials/${encodeURIComponent(id)}`;
}
