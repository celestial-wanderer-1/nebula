# Nebula web scaffold

From the repository root:

```sh
make web-install
pnpm --dir web run e2e:install
make web-build
make test
```

The browser installation is a one-time Playwright prerequisite. On Linux hosts
missing Chromium system libraries, use `pnpm --dir web exec playwright install-deps chromium`.

Build, development, typecheck, unit-test, and browser-test commands generate the
protobuf types and plugin fixture first. `make test` runs typecheck, lint,
format check, Vitest and Playwright. Vitest runs unit and component tests under
`src/`; Playwright runs `e2e/` tests against a freshly built mock bundle on
port 4173.

## Mock backend and dev modes

The UI is built against a mock backend (MSW, `src/mocks/`) until `nebula serve`
exists ([the UI plan](../docs/UI.md), Section 7).

- `pnpm --dir web run dev` runs against the mock and prints its launch URL,
  `http://localhost:5173/#token=mock-token`. Like `nebula serve`'s URL, it
  carries the token in the fragment; reloading needs the URL again.
- `NEBULA_SERVER=http://127.0.0.1:<port> pnpm --dir web run dev` proxies the API
  and WebSocket paths to a running `nebula serve` instead; open the URL it
  printed, with the Vite port.
- `pnpm --dir web run build:mock` bundles the mock (Playwright uses this);
  `build` never includes it or `public/mockServiceWorker.js`.

Mock builds take a scenario in the fragment, for example
`#token=mock-token&scenario=version-mismatch`, and expose scripted situations
as `window.__nebulaMock` (see `src/mocks/scenarios.ts`).

## Wire conventions

These implementation details are what the FastAPI server must match:

- REST paths follow ARCHITECTURE.md Section 13.2 without a prefix (`/version`,
  `/projects`, `/plugins`, ...). Bodies use the protobuf JSON mapping.
- The token is sent as `Authorization: Bearer <token>`. WebSocket handshakes
  offer the subprotocols `nebula.v1` and `nebula.token.<token>`; a rejected
  token closes with code 4401.
- Draft updates are `PATCH /projects/{p}/{kind}/{id}` with
  `If-Match: "<revision>"`; a stale revision returns 409 with a `DraftConflict`
  body.
- WebSocket frames are protobuf JSON text of the channel's message
  (`EntityChange`, `QueueEvent`, `TelemetryEvent`).
- The UI refuses a server whose `/version` `api_version` differs from
  `UI_API_VERSION` in `src/api/version.ts`.

## Static serving contract

The production build writes `web/dist/`. The FastAPI server should serve its
`assets/` directory as static files and serve `index.html` for browser routes
such as `/p/{projectId}/workflows`. API and WebSocket routes must retain their
own handlers and must not use the HTML fallback. Keep `index.html` revalidated;
the content-hashed files under `assets/` may be cached as immutable.
