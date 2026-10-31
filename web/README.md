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
  (`EntityChange`, `QueueEvent`, `RunEvent`, `TelemetryEvent`).
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

- `GET /projects/{p}/{segment}/{id}/versions/{hash}` returns an
  `EntityVersion`: the `VersionMeta` and the immutable content, in which
  every reference is pinned. An unknown hash returns 404. The tessellation
  takes `?version={hash}` too, to build a geometry version.
- Region, Scenario, ConductorNetwork and Workflow drafts use the generic
  entity routes; their content is a `nebula.core.v1.Region`, `Scenario`,
  `ConductorNetwork` or `Workflow`. String fields annotated with
  `ui.id_ref` hold stable IDs (components, circuits, elements, supplies).
  New elements, supplies and feedback loops get their ID from the client
  when they are created.
- `GET /projects/{p}/workflow-templates` lists `WorkflowTemplate`s: the
  standard chains and the project concept's default workflow.
  `POST /projects/{p}/workflows/instantiate` takes an
  `InstantiateWorkflowRequest` and returns 201 with the new `EntityDraft`,
  or 422 for a template the project cannot use.
- `POST /projects/{p}/workflows/{w}/validate` validates the saved draft and
  takes a `ValidateWorkflowRequest` (`gpus`, 0 for the default). It returns a
  `ValidateWorkflowResponse`. Issue paths are `nodes/{id}`,
  `nodes/{id}/ports/{port}`, `edges/{id}` or empty, and every issue has a
  `code`: `empty`, `unknown_extension`, `invalid_parent`, `missing_input`,
  `unknown_port`, `port_mismatch`, `time_series`, `cycle`, `missing_trait`,
  `circuit`, `geometry`, `rank_count` or `gpus`.
- Workflow ports come from the manifests on `/plugins`: an `Extension`'s
  `inputs` and `outputs` are `PortDecl`s typed by sub-contract or, for inputs
  bound with a reference, by entity kind. A stored-output node has one
  output port named `output`, and an input-dataset node one named
  `dataset`.
- `GET /projects/{p}/inputs` lists `InputDataset`s. `POST /projects/{p}/inputs?name=&sub_contract=`
  uploads an HDF5 file as the raw body (`Content-Type: application/x-hdf5`)
  and returns 201 with the `InputDataset`. A body without the HDF5 signature
  returns 422.
- `GET /projects/{p}/runs` returns a `ListRunsResponse`, newest first, and
  `GET /projects/{p}/runs/{r}/outputs` returns a `ListRunOutputsResponse`.

- `POST /projects/{p}/runs` takes a `SubmitRunRequest` and returns a
  `SubmitRunResponse`. The server validates the workflow's saved draft and
  resolves the cache. With `dry_run` it only reports: the drafts it would
  mint (`DraftToMint`, dependencies first, `reuses_version` when the content
  equals an existing version), the cached steps, the default GPU count, the
  installed GPUs and the allowed counts. Otherwise it mints every reached
  draft in one pass, rewriting `draft` and `latest` references to `pinned`
  in the minted versions, and returns 201 with the `Run`. That Run is
  `RUN_STATE_COMPLETED` with `cache_hit` when every step is cached; its
  outputs then carry `producer_run_id`. A request with blocking issues
  returns 200 with the `issues` and no `run`. `gpus` 0 takes the default.
- `GET /projects/{p}/runs/{r}` returns the `Run`.
  `POST /projects/{p}/runs/{r}/actions` takes a `RunActionRequest` (pause,
  resume, cancel, discard) and returns the `Run`, or 409 `invalid_state`
  when the state does not allow it (A§14.1). Resume needs `RUN_STATE_PAUSED`,
  or `RUN_STATE_FAILED` with a transient reason (`oom`, `crashed`,
  `supervisor_lost`) and `has_checkpoint` on the last attempt.
  `POST /projects/{p}/runs/{r}/rerun` takes a `RerunRequest` (same or latest
  inputs) and returns 201 with the new `Run`. "Re-run with edited workflow"
  is a submission with `rerun_of` set.
- `GET /queue` returns a `ListQueueResponse`: waiting Runs in FIFO order
  (`position` from 1), then running and paused ones. `POST /queue/reorder`
  takes a `ReorderQueueRequest` and returns 204, or 409 for a Run that is not
  waiting. `POST /queue/{r}/cancel` cancels a Run of any project.
- `/ws/queue` sends `summary` and `entries` on connect and whenever they
  change, plus a `run_state` event per Run state change.
- `/ws/runs/{r}` sends `RunEvent`s: a `run` snapshot on connect and on every
  state change, which replaces what the client holds, then step status,
  residuals, structured log lines, committed outputs and checkpoints. On
  connect the server first replays the recent progress it holds (the mock
  keeps 400 events per Run). The client keeps progress in bounded buffers
  and starts them over on every connect.
- Mock builds also expose run controls on `window.__nebulaMock`:
  `scriptNextRun(name)` (success, slow, oom, diverged, nan, crashed,
  supervisor_lost, geometry_failed), `setRunMode("manual" | "auto")`,
  `advance(ms)`, `runUntil(runId, state)`, `setTiming(scale)`,
  `setEngineBuild(build)` and `setGpuModel(model)`.

## Bundles

Heavy views load lazily through `src/viewers/lazy.tsx`, so each library is
a separate chunk fetched only where it is used: three.js and React Three
Fiber with the geometry viewport and the region placement view, React Flow
with the workflow canvas, and Plotly (its basic bundle, without the WebGL
traces) with charts. Headless Playwright runs draw WebGL views with software
WebGL (SwiftShader; see `playwright.config.ts`).

## Static serving contract

The production build writes `web/dist/`. The FastAPI server should serve its
`assets/` directory as static files and serve `index.html` for browser routes
such as `/p/{projectId}/workflows`. API and WebSocket routes must retain their
own handlers and must not use the HTML fallback. Keep `index.html` revalidated;
the content-hashed files under `assets/` may be cached as immutable.
