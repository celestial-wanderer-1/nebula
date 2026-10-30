import { useMemo, type ReactNode } from "react";
import { AuthError, NetworkError, ServerError } from "../api/errors";
import { usePlugins } from "../api/plugins";
import { setTypeRegistry } from "../api/registry";
import { getToken } from "../api/token";
import { UI_API_VERSION, UI_BUILD, useVersionInfo } from "../api/version";
import { SchemaRegistry } from "../schema/registry";

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="gate">
      <p className="eyebrow">Nebula</p>
      <h1>{title}</h1>
      {children}
    </main>
  );
}

function TokenScreen({ rejected }: { rejected?: boolean }) {
  return (
    <Screen
      title={
        rejected ? "Access token rejected" : "Open Nebula from its launch URL"
      }
    >
      <p>
        {rejected
          ? "The server did not accept this page's access token. It changes every time the server starts."
          : "This page has no access token."}{" "}
        Open the URL that <code>nebula serve</code> printed when it started.
      </p>
      <p className="muted">
        The token is kept in memory only, so reloading the page also requires
        that URL again.
      </p>
    </Screen>
  );
}

/**
 * Renders the app only against a compatible server (D137): a token must be
 * present, `/version` must match this build's API version, and the plugin
 * descriptors must be loaded into the schema registry.
 */
export function ConnectionGate({
  children,
}: {
  children: (registry: SchemaRegistry) => ReactNode;
}) {
  const token = getToken();
  const version = useVersionInfo({ enabled: Boolean(token) });
  const compatible = version.data?.apiVersion === UI_API_VERSION;
  const plugins = usePlugins({ enabled: compatible });
  const registry = useMemo(() => {
    if (!plugins.data) return undefined;
    const schema = new SchemaRegistry(plugins.data);
    setTypeRegistry(schema.typeRegistry);
    return schema;
  }, [plugins.data]);

  if (!token) return <TokenScreen />;

  const failure = version.error ?? (compatible ? plugins.error : null);
  if (failure instanceof AuthError) return <TokenScreen rejected />;
  if (failure) {
    // 502-504 come from a proxy or SSH forward whose server is down.
    const unreachable =
      failure instanceof NetworkError ||
      (failure instanceof ServerError &&
        [502, 503, 504].includes(failure.status));
    return (
      <Screen title={unreachable ? "Server unreachable" : "Cannot connect"}>
        <p>
          {unreachable
            ? "The Nebula server did not answer. Check that nebula serve is still running."
            : failure.message}
        </p>
        <button
          type="button"
          className="primary"
          onClick={() => {
            void version.refetch();
            void plugins.refetch();
          }}
        >
          Retry
        </button>
      </Screen>
    );
  }

  if (version.data && !compatible) {
    return (
      <Screen title="Incompatible server">
        <p>
          This page was built for a different Nebula server. Open the URL
          printed by the server you are running, or update Nebula.
        </p>
        <dl className="details">
          <dt>Server API version</dt>
          <dd>{version.data.apiVersion || "unknown"}</dd>
          <dt>Server build</dt>
          <dd>
            {version.data.serverVersion} ({version.data.buildId})
          </dd>
          <dt>UI API version</dt>
          <dd>{UI_API_VERSION}</dd>
          <dt>UI build</dt>
          <dd>{UI_BUILD}</dd>
        </dl>
      </Screen>
    );
  }

  if (!registry) {
    return (
      <main className="gate" aria-busy="true">
        <p className="muted">Connecting…</p>
      </main>
    );
  }
  return children(registry);
}
