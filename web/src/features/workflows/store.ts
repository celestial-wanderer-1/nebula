import { create } from "zustand";

// View state of the workflow editor: the selected node per workflow. Not
// server state, so it lives in Zustand rather than the query cache.

interface WorkflowViewState {
  selected: Record<string, string | undefined>;
  select: (workflowId: string, nodeId: string | undefined) => void;
}

export const useWorkflowView = create<WorkflowViewState>()((set) => ({
  selected: {},
  select: (workflowId, nodeId) =>
    set((state) => ({ selected: { ...state.selected, [workflowId]: nodeId } })),
}));

export function useSelectedNode(workflowId: string): string | undefined {
  return useWorkflowView((state) => state.selected[workflowId]);
}

/** Back to the initial state; for tests. */
export function resetWorkflowView(): void {
  useWorkflowView.setState({ selected: {} });
}
