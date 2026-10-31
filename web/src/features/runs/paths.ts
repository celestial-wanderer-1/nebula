export const runPath = (projectId: string, runId: string) =>
  `/p/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`;
