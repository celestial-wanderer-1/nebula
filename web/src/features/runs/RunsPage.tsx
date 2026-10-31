import * as Tabs from "@radix-ui/react-tabs";
import { useParams, useSearchParams } from "react-router";
import { QueueView } from "./QueueView";
import { RunList } from "./RunList";

/** The project's Runs and the queue shared across projects (6.6). */
export function RunsPage() {
  const { projectId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "queue" ? "queue" : "runs";
  return (
    <section>
      <h1>Runs and queue</h1>
      <Tabs.Root
        value={tab}
        onValueChange={(value) => setParams({ tab: value }, { replace: true })}
      >
        <Tabs.List className="tabs" aria-label="Runs and queue">
          <Tabs.Trigger value="runs" className="tab">
            Project runs
          </Tabs.Trigger>
          <Tabs.Trigger value="queue" className="tab">
            Queue
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="runs" className="tab-panel">
          <RunList projectId={projectId} />
        </Tabs.Content>
        <Tabs.Content value="queue" className="tab-panel">
          <QueueView />
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}
