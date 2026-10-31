import { ENTITY_LABELS } from "../../entities/kinds";
import { shortHash } from "../../entities/references";
import {
  DeterminismMode,
  type Provenance,
} from "../../gen/nebula/core/v1/run_pb";

/** What the Run pinned at submission (A§4.3). */
export function ProvenancePanel({
  provenance,
}: {
  provenance: Provenance | undefined;
}) {
  if (!provenance) {
    return <p className="muted small">No provenance recorded.</p>;
  }
  const overrides = Object.entries(provenance.overrides?.values ?? {});
  return (
    <dl className="details provenance">
      <dt>Workflow version</dt>
      <dd>
        <code title={provenance.workflowVersionHash}>
          {shortHash(provenance.workflowVersionHash)}
        </code>
      </dd>
      <dt>Inputs</dt>
      <dd>
        <ul>
          {provenance.inputs.map((input) => (
            <li key={`${input.kind}/${input.id}/${input.versionHash}`}>
              {ENTITY_LABELS[input.kind]} “{input.name}”{" "}
              <code title={input.versionHash}>
                {shortHash(input.versionHash)}
              </code>
            </li>
          ))}
        </ul>
      </dd>
      {provenance.storedInputs.length > 0 && (
        <>
          <dt>Stored outputs and datasets</dt>
          <dd>
            {provenance.storedInputs.map((hash) => (
              <code key={hash} title={hash}>
                {shortHash(hash)}{" "}
              </code>
            ))}
          </dd>
        </>
      )}
      {overrides.length > 0 && (
        <>
          <dt>Overrides</dt>
          <dd>
            {overrides.map(([path, value]) => `${path} = ${value}`).join(", ")}
          </dd>
        </>
      )}
      <dt>Concept</dt>
      <dd>
        {provenance.concept?.conceptId} {provenance.concept?.version}
      </dd>
      <dt>Plugins</dt>
      <dd>
        <ul>
          {provenance.plugins.map((plugin) => (
            <li key={plugin.pluginId}>
              {plugin.pluginId} {plugin.version}{" "}
              <code title={plugin.soHash}>{shortHash(plugin.soHash)}</code>
            </li>
          ))}
        </ul>
      </dd>
      <dt>Engine build</dt>
      <dd>
        <code>{provenance.engineBuild}</code>
      </dd>
      <dt>Source</dt>
      <dd>
        engine {provenance.source?.engineCommit}, {provenance.source?.compiler}
        {provenance.source?.dirty ? ", dirty tree" : ""}
      </dd>
      <dt>Mode</dt>
      <dd>
        {provenance.mode === DeterminismMode.FAST ? "fast" : "deterministic"}
      </dd>
    </dl>
  );
}
