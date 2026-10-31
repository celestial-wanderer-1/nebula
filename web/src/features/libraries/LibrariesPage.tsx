import * as Tabs from "@radix-ui/react-tabs";
import { useParams, useSearchParams } from "react-router";
import { GlobalComponents, GlobalMaterials } from "./GlobalLibrary";
import { LIBRARY_TABS, type LibraryTab } from "./paths";
import { ProjectComponents } from "./ProjectComponents";
import { ProjectMaterials } from "./ProjectMaterials";

const TAB_LABELS: Readonly<Record<LibraryTab, string>> = {
  components: "Project components",
  materials: "Project materials",
  "global-components": "Global components",
  "global-materials": "Global materials",
};

const isTab = (value: string | null): value is LibraryTab =>
  LIBRARY_TABS.includes(value as LibraryTab);

/**
 * Project and user-global component and material libraries (docs/UI.md
 * 6.2). The tab is in `?tab=`, so links can open a given tab.
 */
export function LibrariesPage() {
  const { projectId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const tab: LibraryTab = isTab(requested) ? requested : "components";

  return (
    <section className="libraries">
      <h1>Libraries</h1>
      <Tabs.Root
        value={tab}
        onValueChange={(value) => setParams({ tab: value }, { replace: true })}
      >
        <Tabs.List className="tabs" aria-label="Libraries">
          {LIBRARY_TABS.map((value) => (
            <Tabs.Trigger key={value} value={value} className="tab">
              {TAB_LABELS[value]}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="components" className="tab-panel">
          <ProjectComponents projectId={projectId} />
        </Tabs.Content>
        <Tabs.Content value="materials" className="tab-panel">
          <ProjectMaterials projectId={projectId} />
        </Tabs.Content>
        <Tabs.Content value="global-components" className="tab-panel">
          <GlobalComponents projectId={projectId} />
        </Tabs.Content>
        <Tabs.Content value="global-materials" className="tab-panel">
          <GlobalMaterials projectId={projectId} />
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}
