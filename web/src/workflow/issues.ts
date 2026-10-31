import type { ValidationIssue } from "../gen/nebula/core/v1/project_pb";

/** Validation issues grouped by what they are on (docs/UI.md 6.5). */
export interface IssueIndex {
  /** By node ID, including issues on its ports. */
  nodes: Map<string, ValidationIssue[]>;
  /** By "<nodeId>/<port>". */
  ports: Map<string, ValidationIssue[]>;
  edges: Map<string, ValidationIssue[]>;
  /** Issues on the workflow as a whole. */
  general: ValidationIssue[];
}

const push = <K>(
  map: Map<K, ValidationIssue[]>,
  key: K,
  issue: ValidationIssue,
) => map.set(key, [...(map.get(key) ?? []), issue]);

/**
 * Indexes issues by path: "nodes/{id}", "nodes/{id}/ports/{port}" or
 * "edges/{id}" (workflow.proto). Other paths are general.
 */
export function indexIssues(issues: readonly ValidationIssue[]): IssueIndex {
  const index: IssueIndex = {
    nodes: new Map(),
    ports: new Map(),
    edges: new Map(),
    general: [],
  };
  for (const issue of issues) {
    const [root, id, sub, port] = issue.path.split("/");
    if (root === "nodes" && id) {
      push(index.nodes, id, issue);
      if (sub === "ports" && port) push(index.ports, `${id}/${port}`, issue);
    } else if (root === "edges" && id) {
      push(index.edges, id, issue);
    } else {
      index.general.push(issue);
    }
  }
  return index;
}
