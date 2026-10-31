import { Link } from "react-router";
import { shortHash } from "../../entities/references";
import type { RunOutput } from "../../gen/nebula/core/v1/output_pb";
import { OUTPUT_KINDS, outputKey } from "./outputs";

/**
 * A Run's outputs by step (docs/UI.md 6.7): kind, sub-contract and content
 * hash; live Runs add outputs as they commit (D122).
 */
export function OutputList({
  outputs,
  labels,
  selected,
  linkTo,
}: {
  outputs: readonly RunOutput[];
  labels: ReadonlyMap<string, string>;
  selected?: string;
  linkTo: (output: RunOutput) => string;
}) {
  if (outputs.length === 0) {
    return <p className="muted small">No outputs committed yet.</p>;
  }
  return (
    <table className="table output-list" aria-label="Outputs">
      <thead>
        <tr>
          <th scope="col">Output</th>
          <th scope="col">Kind</th>
          <th scope="col">Hash</th>
        </tr>
      </thead>
      <tbody>
        {outputs.map((output) => {
          const key = outputKey(output);
          return (
            <tr
              key={key}
              aria-current={key === selected ? "true" : undefined}
              data-output={key}
            >
              <th scope="row">
                <Link to={linkTo(output)}>
                  {labels.get(output.nodeId) ?? output.nodeId} · {output.name}
                </Link>
                {output.timeSeries && (
                  <span className="badge badge-info">time series</span>
                )}
                <span className="muted small sub-contract">
                  {output.subContract}
                </span>
              </th>
              <td>{OUTPUT_KINDS[output.kind]}</td>
              <td>
                <code title={output.contentHash}>
                  {shortHash(output.contentHash)}
                </code>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
