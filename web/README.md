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
`src/` and `stub-server/`; Playwright runs `e2e/` tests twice, against a
freshly built mock bundle on port 4173 and against the production bundle on
the stub server on port 4174 (see [Stub server](#stub-server)).

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
  (`EntityChange`, `QueueEvent`, `RunEvent`, `TelemetryEvent`; on
  `/ws/views`, `ViewRequest` from the client and `ViewReply` back).
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

- `/ws/views` is request and reply (A§3.6): the client sends a
  `ViewRequest` with a fresh `request_id` per change of output, viewer or
  `ViewParams`, and the server answers with a `ViewReply` carrying that ID,
  a `ViewPayload` or an `ApiError` (`not_found`, `not_viewable`), and
  `cached` for a payload-cache hit. Replies are not replayed after a
  reconnect; the client resends its pending request. Payloads are Plotly
  figures (`{"data", "layout"}` as a `Struct`), vtk.js polydata or binary
  glTF. Polydata points are little-endian float32 relative to the payload
  `origin`, and cells use the VTK layout (count, then point IDs) as
  little-endian uint32. The client places the actor at the origin and never
  adds it to the points (D156). A glTF with an external `uri` is refused
  (D117).
- A Run output's `kind` and, for fields on a region, `region_type` choose
  its viewers; an `Extension`'s `views` (view descriptors) come first. A
  `SCALARS` output carries its values inline in `scalars` (an `Any`). Time
  series carry their `time` axis, and `ViewParams.time_index` picks a slice.

- `POST /projects/{p}/comparisons` takes a `CreateComparisonRequest` (Run
  IDs of the project and a shared Region) and returns 201 with the
  `Comparison`: scalar rows across the Runs, each with its declared
  `tolerance` (the core `tolerance` field option) and `out_of_tolerance`,
  and the outputs the Runs share with one `OutputRef` per Run. Fewer than
  two Runs, or Runs of another project, return 422. `GET` lists and reads
  them. A difference view is a `ViewRequest` with `reference` and `region`
  set: `output` minus `reference`, resampled on the region (D104).
- `POST /projects/{p}/studies` takes a `CreateStudyRequest` and returns 201
  with the `Study` in `STUDY_STATE_DRAFT`, one point per combination of the
  variables' values. The base version must be a version of the workflow
  (422 otherwise), and `concurrency` 0 means the installed GPU count.
  `POST .../studies/{s}/start` and `.../stop` return the `Study`. Each point
  becomes a Run of the base version with the point's `ParameterOverride`,
  which is part of its cache key and provenance, and with `study_id` set,
  so its state changes reach `/ws/queue` as `run_state` events carrying the
  study. Override paths are `nodes/{node}/config/{field}`,
  `scenarios/{id}/currents/{circuit}/current`,
  `scenarios/{id}/plasma_targets/{i}/{field}` and
  `components/{id}/shape/{field}`.
- `POST /projects/{p}/runs/{r}/rerun` with `RERUN_INPUTS_LATEST` is the
  one-click re-run of a stale Run. A Run is stale when an input it pinned
  has a newer head version; the client checks this against the entity
  lists. A solved scenario is minted as a version but does not move the
  scenario's head.
- `GET /projects/{p}/storage` returns `StorageUsage` by `StorageClass`.
  `POST .../storage/evict` takes an `EvictRequest` and returns
  `EvictResponse`; primary results and logs cannot be evicted (422).
  `GET .../storage/dependents?run={r}` lists the stored-output nodes,
  in drafts and versions, that refer to a Run's outputs.
  `POST .../storage/delete` takes a `DeleteResultsRequest`; with dependents
  it needs `acknowledge_dependents`, or it returns 409 `in_use`. The Runs'
  records stay.
- `GET /settings` returns the read-only `Settings` (the TOML file).
  `PUT /projects/{p}/settings` takes `ProjectSettings` and returns the
  `Project`.
- Mock builds add `largeGeometry(factor = 8)`, meshes `factor` times finer
  in each direction (about 500k triangles for the baseline geometry), for
  the performance checks.

## Bundles

Feature areas load lazily through React Router's `lazy`, one chunk each, and
heavy views load lazily through `src/viewers/lazy.tsx`, so each library is
a separate chunk fetched only where it is used: three.js and React Three
Fiber with the geometry viewport and the region placement view, React Flow
with the workflow canvas, vtk.js with the 2D contour, 3D field, Poincaré
and mode-structure viewers, and Plotly (its basic bundle, without the WebGL
traces) with charts. Headless Playwright runs draw WebGL views with software
WebGL (SwiftShader; see `playwright.config.ts`).

`pnpm run build` ends with `scripts/check-bundle.mjs`, which reads the chunk
graph the build writes (`dist/.vite/chunks.json`) and fails when:

- the entry chunk's static imports reach three.js, React Three Fiber,
  vtk.js, Plotly or React Flow;
- any chunk contains the mock backend or MSW;
- any script contains `eval(` or `new Function(`, which the CSP forbids;
- `mockServiceWorker.js` ships.

## Content Security Policy

The bundle runs under a strict policy (D117): no inline or `eval`'d
scripts, and style elements only with the page's nonce.
`index.html` carries `<meta name="csp-nonce" content="NEBULA_CSP_NONCE">`.
The server must replace the placeholder with a fresh random nonce per
response and send it in its policy. The app passes the nonce to the
libraries that insert `<style>` elements (Radix's scroll lock). Plotly
inserts one empty `<style>` element and fills it through the CSSOM; the
hash of the empty string admits only that. The production bundle needs no
workers, so `worker-src` stays at `'none'`:

```text
default-src 'none'; script-src 'self';
style-src 'self' 'nonce-<nonce>' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';
img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://<host>;
manifest-src 'self'; base-uri 'none'; form-action 'none';
frame-ancestors 'none'; object-src 'none'
```

The stub server sends this policy with a fresh nonce. Mock-mode `vite
preview` sends it with the placeholder as the nonce, plus `worker-src` for
MSW's service worker. Playwright fails any test, in either mode, that
triggers a violation or an uncaught page error (`e2e/test.ts`).

## Serving and security contract

What `nebula serve` must do in front of the bundle (A§16.1, D90, D117,
D137). The stub server (below) implements it, and `e2e/security.spec.ts`
checks it.

- Bind `127.0.0.1` only, and print the launch URL with a per-launch token in
  the fragment: `http://127.0.0.1:<port>/#token=<token>`.
- Refuse, with 403, any request whose `Host` is not `127.0.0.1:<port>` or
  `localhost:<port>` (DNS rebinding), and any request, WebSocket upgrades
  included, whose `Origin` is present and not the server's own.
- Require `Authorization: Bearer <token>` on every API request (401 JSON
  `ApiError` otherwise; a token in the query string does not count), and the
  `nebula.token.<token>` subprotocol on every WebSocket (close code 4401
  otherwise). Echo only the `nebula.v1` subprotocol, never the token.
- Serve `web/dist/`: `index.html` with `Cache-Control: no-cache` and a fresh
  nonce, the content-hashed files under `assets/` as immutable, and
  `index.html` for browser routes such as `/p/{projectId}/workflows`. API
  paths (`src/api/paths.ts`), `/ws/` paths and missing assets never fall
  back to HTML: an unknown API path is a JSON 404.
- Send on every response: the policy above, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`; API
  responses also `Cache-Control: no-store`.

## Stub server

`web/stub-server/` stands in for `nebula serve` until it exists: a Node
server that serves the production `dist/` under the contract above, with
the API and WebSocket channels answered by the mock backend's handlers
(`src/mocks/`). It is a test tool, never shipped.

```sh
pnpm --dir web run stub            # builds both, then serves on port 4174
node web/stub-server/dist/main.mjs --port 4174 --dist web/dist
```

The token is random per launch, or `NEBULA_STUB_TOKEN`. Tests control the
backend through `POST /__stub/reset` and `POST /__stub/scenario` (body
`{"name", "args"}`, names from `src/mocks/scenarios.ts`), which take the
token like the API. These `/__stub/` endpoints are not part of the API
contract.

`make test` runs the Playwright suite twice: `mock` against the mock bundle
under `vite preview`, and `real` (`pnpm run e2e:real`, `E2E_TARGET=real`)
against the production bundle on the stub server, one test at a time with a
reset before each. `e2e/backend.ts` hides the difference.
`security.spec.ts` runs in `real` only.

## Accessibility

`e2e/a11y.spec.ts` runs axe (WCAG 2.0 and 2.1, A and AA) on every area,
dialog and viewer, and checks the keyboard flows: the skip link, area
navigation, dialogs that trap and return focus, and building a workflow
with the palette and the connect form, the keyboard route for wiring that
the canvas offers by dragging. Plotly charts are figures, not images, since
their mode bar is interactive; each has a "Show data" table.

## Performance baselines

Provisional (D161), from `e2e/perf.spec.ts` on a development machine with
headless Chromium and software WebGL; the spec's bounds are loose sanity
checks, not targets. Times run from data requested or received
(`src/perf.ts` spans, in the browser's performance timeline) to the first
drawn frame.

| Case                                               | Mock   | Stub   |
| -------------------------------------------------- | ------ | ------ |
| Geometry, 524,288 triangles, request to drawn      | 0.34 s | 0.87 s |
| Selecting a component with that geometry shown     | 47 ms  | 46 ms  |
| vtk.js slice, 1M points, payload to drawn          | 2.2 s  | 2.5 s  |
| Plotly profiles, 2 × 100k points, payload to drawn | 63 ms  | 107 ms |

In mock mode the mock backend tessellates in the page; against the stub the
geometry time includes building and transferring a 12.6 MB tessellation.
Plotly simplifies dense lines as it draws them, which keeps large profiles
cheap. Symmetry replicas of a surface are one `InstancedMesh`, and mesh and
polydata arrays decode with one copy each.
