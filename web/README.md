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
- Entities are created with `POST /projects/{p}/{segment}` and a
  `CreateEntityRequest` body (`name`, `content` as an `Any`), which returns
  201 with the `EntityDraft` at revision 1. `DELETE /projects/{p}/{segment}/{id}`
  returns 204, or 409 with an `ApiError` of code `in_use` (for example
  `Referenced by geometry "<name>"`) while a geometry draft references the
  component. Both publish an `EntityChange` (`CREATED`, `DELETED`). Segments
  are those of `ENTITY_SEGMENTS` in `src/api/entities.ts`: `geometries`,
  `components`, `regions`, `scenarios`, `conductor-networks`, `workflows`.
- A component draft's content is a `nebula.core.v1.Component`: the shape as an
  `Any`, a `material_id` and, when imported, its `LibrarySource`.
- Project materials are not versioned entities: `GET /projects/{p}/materials`
  (`ListMaterialsResponse`), `POST` (`MaterialRequest`, 201 `Material`), and
  `GET`, `PUT` (last write wins) and `DELETE` on
  `/projects/{p}/materials/{m}`. `DELETE` returns 409 `in_use` while a
  component draft uses the material.
- The user-global library: `GET /library/components` and
  `GET /library/components/{id}` (`ListLibraryComponentsResponse`,
  `LibraryComponent`), and `POST /library/components` with an
  `AddToLibraryRequest` (`project_id`, `item_id`, `description`), which
  returns 201. `/library/materials` works the same with `LibraryMaterial`.
- Imports take an `ImportFromLibraryRequest` (`entry_id`) and return 201:
  `POST /projects/{p}/components/import` returns the new component's
  `EntityDraft`; `POST /projects/{p}/materials/import` returns the `Material`.
  Both set `source`. A component import also imports its library material,
  unless a project material already has that `source.entry_id`, and rewrites
  `material_id` to the project material.
- `GET /projects/{p}/geometries/{g}/tessellation[?component={id}]` returns a
  `GeometryTessellation` with one `ComponentTessellation` per component
  reference of the geometry draft (one with `?component=`). A reference
  resolves by its state: `draft` builds the component's current draft
  (`revision` = draft revision, `version_hash` empty); `latest` builds the head
  version and `pinned` the pinned one (`revision` 0, `version_hash` = that
  version). The UI ignores a draft build older than the one it shows, so a
  late reply never rolls a mesh back (D148).
  `Mesh.positions` are little-endian float32 x, y, z triples in metres relative
  to `Mesh.origin`; `Mesh.indices` are little-endian uint32 triangle indices,
  empty for line topologies. Both travel as base64 strings, the protobuf JSON
  mapping of `bytes`. A component that cannot be built has `error` set and no
  mesh. `issues` always cover the whole geometry, with paths `symmetry`,
  `components/{id}` and `circuits/{id}`.
- `GET /projects/{p}/geometries/{g}/step[?version={hash}]` returns 200 with
  `Content-Type: application/step`, an ISO-10303-21 text body and
  `Content-Disposition: attachment; filename="<name>.step"`, where `<name>` is
  the geometry name sanitised like a project export's; with a version it is
  `<name>-<short hash>.step`. An unknown version returns 404.

## Bundles

The geometry editor's 3D viewport (`src/features/geometry/Viewport.tsx`)
loads lazily, so three.js and React Three Fiber are a separate chunk that is
fetched only when a geometry is opened. Headless Playwright runs draw it with
software WebGL (SwiftShader; see `playwright.config.ts`).

## Static serving contract

The production build writes `web/dist/`. The FastAPI server should serve its
`assets/` directory as static files and serve `index.html` for browser routes
such as `/p/{projectId}/workflows`. API and WebSocket routes must retain their
own handlers and must not use the HTML fallback. Keep `index.html` revalidated;
the content-hashed files under `assets/` may be cached as immutable.
