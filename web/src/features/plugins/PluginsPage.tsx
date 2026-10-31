import { usePlugins } from "../../api/plugins";
import { shortHash } from "../../entities/references";
import {
  ExtensionKind,
  PluginOrigin,
  SmokeResult,
} from "../../gen/nebula/core/v1/plugin_pb";
import { useSchema } from "../../schema/context";

const KINDS: Record<ExtensionKind, string> = {
  [ExtensionKind.UNSPECIFIED]: "Other",
  [ExtensionKind.SOLVER]: "Solvers",
  [ExtensionKind.ADAPTER]: "Adapters",
  [ExtensionKind.POST_OP]: "PostOps",
  [ExtensionKind.GEOMETRY_COMPONENT]: "Geometry components",
  [ExtensionKind.CONCEPT]: "Concepts",
  [ExtensionKind.OPTIMIZER]: "Optimizers",
  [ExtensionKind.OBJECTIVE]: "Objectives",
};

const SMOKE: Record<SmokeResult, string> = {
  [SmokeResult.UNSPECIFIED]: "—",
  [SmokeResult.PASSED]: "passed",
  [SmokeResult.FAILED]: "failed",
  [SmokeResult.NOT_RUN]: "not run",
};

/**
 * The core and plugin manifests (docs/UI.md 6.10): versions, ABI
 * fingerprint, `.so` hash, extensions, and smoke V&V per GPU model (D45,
 * D61, D140).
 */
export function PluginsPage() {
  const plugins = usePlugins();
  const schema = useSchema();
  return (
    <main className="page">
      <h1>Plugins</h1>
      {plugins.isPending && <p className="muted">Loading plugins…</p>}
      {plugins.data?.map((plugin) => {
        const pool = schema.pools.find((p) => p.id === plugin.id);
        const byKind = new Map<ExtensionKind, string[]>();
        for (const extension of plugin.extensions) {
          byKind.set(extension.kind, [
            ...(byKind.get(extension.kind) ?? []),
            extension.displayName || extension.id,
          ]);
        }
        return (
          <section
            key={plugin.id}
            className="panel plugin"
            aria-label={`${plugin.id} ${plugin.version}`}
          >
            <h2>
              {plugin.id} <span className="muted">{plugin.version}</span>{" "}
              <span className="badge badge-info">
                {plugin.origin === PluginOrigin.CORE ? "core" : "plugin"}
              </span>
            </h2>
            <dl className="details">
              <dt>ABI</dt>
              <dd>
                {plugin.abi?.compiler}, {plugin.abi?.stdlib},{" "}
                {plugin.abi?.gpuRuntime}, Nebula ABI {plugin.abi?.nebulaAbi}
              </dd>
              <dt>.so hash</dt>
              <dd>
                <code title={plugin.soHash}>{shortHash(plugin.soHash)}</code>
              </dd>
              <dt>Descriptors</dt>
              <dd>
                {plugin.descriptorSet.length === 0 ? (
                  "Compiled into the core"
                ) : pool?.error ? (
                  <span className="field-error">
                    Failed to load: {pool.error}
                  </span>
                ) : (
                  "Loaded"
                )}
              </dd>
            </dl>
            <h3>Extensions</h3>
            <ul>
              {[...byKind].map(([kind, names]) => (
                <li key={kind}>
                  <strong>{KINDS[kind]}:</strong> {names.join(", ")}
                </li>
              ))}
            </ul>
            <table className="table" aria-label={`Smoke V&V of ${plugin.id}`}>
              <thead>
                <tr>
                  <th scope="col">GPU model</th>
                  <th scope="col">Smoke V&amp;V</th>
                </tr>
              </thead>
              <tbody>
                {plugin.smoke.map((smoke) => (
                  <tr key={smoke.gpuModel}>
                    <th scope="row">{smoke.gpuModel}</th>
                    <td>
                      <span
                        className={
                          smoke.result === SmokeResult.FAILED
                            ? "badge badge-error"
                            : "ok"
                        }
                      >
                        {SMOKE[smoke.result]}
                      </span>
                      {smoke.detail && (
                        <span className="muted small"> {smoke.detail}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </main>
  );
}
