# Frontend Architecture

React 19 SPA (~12.8k LOC) under `assets/js/`: TanStack Router (file-based) + Query +
Table, Radix UI, Tailwind 4, i18next, zod, shiki, sonner.

## Architecture map (current state)

- **Bootstrap:** server `main.ts` (Mustache) injects a JSON `DataKitConfig` (API
  URIs, locale, phrases) into the page; `app.tsx` reads it via `lib/config.ts`,
  creates one `QueryClient` (staleTime 30s, retry 1) and a router with
  `basepath: config.toolUri`. Providers: Theme → Query → Tooltip → Router; Sonner at
  root.
- **Routing:** flat file-based routes, generated `routeTree.gen.ts`. Standard
  pattern: `loader: queryClient.ensureQueryData(xQueryOptions())` +
  `useSuspenseQuery` in the component. Only the node browser validates URL search
  params with zod.
- **Data layer:** `lib/api/*` — one module per resource: raw fetch wrappers (via
  shared `apiFetch` in `client.ts`, which unwraps the `{data}` envelope),
  `queryOptions()` factories, `useMutation` hooks with inline invalidation. No
  central query-key registry.
- **Long-running tasks:** mutations return `{taskId}`; pages combine
  `taskQueryOptions(taskId)` (1.5s polling) with `useTaskProgress(taskId)` (WS
  patching of the `['tasks', id]` cache via `setQueryData`). WS transport is a
  hand-rolled refcounted singleton (`lib/websocket.ts` + `use-websocket.ts`)
  connecting to `apis/events`.
- **State placement:** server data in query cache; node-browser location in URL;
  search & audit filters/results in component state; events stream in refs + 200ms
  snapshot interval (deliberately outside React/query — correct).
- **NoQL:** pure, UI-free module (tokenizer → recursive-descent validator +
  Levenshtein suggest), used by the Search page for debounced validation.
- **i18n:** server-resolved phrase bundle (single locale) fed into i18next at import
  time; all UI text goes through `t()`.

## High

### FA-1 — Task-event invalidation storm + redundant polling
`lib/hooks/use-task-progress.ts:111-123`, `lib/api/tasks.ts:53-72`

`useTasksListRefresh` invalidates `['tasks','list']` on *every* `task.*` WS event,
including high-frequency `task.updated` progress ticks — each tick refetches the
entire task list, on top of the list's own 5s `refetchInterval`. Meanwhile
`taskQueryOptions` hardcodes 1.5s polling; `ProgressDialog`
(`progress-dialog.tsx:36-42`) suppresses polling when WS is open, but dumps/exports
pages mount a *second* observer via plain `useQuery(taskQueryOptions(...))`
(`exports.tsx:772`, `dumps.tsx:637`) whose default 1.5s interval keeps firing,
defeating the suppression.
**Fix:** debounce/throttle list invalidation on terminal events only; make WS-aware
interval logic part of `taskQueryOptions` itself so all observers share it.

### FA-2 — Mass duplication of node-action dialogs and task orchestration
`routes/repositories.$repoId.$branch.tsx:186-729` vs
`components/node-detail-panel.tsx:449-973`; `routes/dumps.tsx:625-829` vs
`routes/exports.tsx:760-958`

Rename/Move/Push/Create/Delete dialogs (validation, toasts, reset-on-close) exist
twice nearly verbatim (~400 lines each copy) in RowActions and PanelActions. The
whole task lifecycle scaffold (`ActiveTask` type, `handledRef` one-shot effect,
`TASK_TYPE_KEYS`/`TASK_COMPLETE_KEYS`, progress row, completion dialog) is duplicated
between dumps and exports — and already diverging (exports uses `ProgressDialog`,
dumps inlines its own dialog with different close semantics).
**Fix:** extract `components/node-actions/` dialog set and a `useTaskRunner` hook +
shared `TaskCompletionDialog`. (Cluster detail in [04, D1–D4](04-frontend-quality.md#duplication-clusters).)

### FA-3 — Hand-duplicated client/server contracts, zero boundary validation
`lib/api/client.ts:49-50`, `lib/api/exports.ts:6-12` vs server `lib/exports.ts:11-17`,
`lib/config.ts:6-29` vs `admin/tools/main/main.ts:12-38`, `lib/websocket.ts:1-13` vs
`apis/events/events.ts:10-20`, `lib/api/nodes.ts:6-13` vs `apis/nodes/nodes.ts:8-15`

Every DTO is written twice — once in the server handler, once in the client API
module (`ExportEntry` is a verbatim copy). `apiFetch` asserts `envelope.data as T`;
zod is installed and used for form inputs and route search, but never validates a
single API response. Both sides are TypeScript in the same repo — the drift risk is
entirely avoidable.
**Fix:** shared type-only DTO modules (erased at compile) or zod schemas as the
single source with `z.infer` on both sides (P1; = SRV-R3, BLD-P5).

## Medium

### FA-4 — Missing invalidations after cross-branch/global mutations
`lib/api/nodes.ts:281-285` — `usePushNode` invalidates nothing; the target branch's
`['nodes', ...]` lists stay stale for up to 30s after a push.
`lib/api/snapshots.ts:76-84` — restoring a snapshot rewrites repo data but only
invalidates `['snapshots']`. `useDeleteNode` (`nodes.ts:271-279`) skips
`['node-detail']`. **Fix:** invalidate `['nodes']`/`['node-detail']` (and
`['repositories']` after restore); a key factory makes these omissions visible (P4).

### FA-5 — Search and Audit state is ephemeral and off-URL
`routes/search.tsx:96-103`, `routes/audit.tsx:129-132`

Search results live in component state fetched through a *mutation* — navigating
away loses everything; no caching, no shareable URL; pagination refetches with no
reuse. Inconsistent with the node browser, which models everything in validated
search params. **Fix:** `validateSearch` + `queryOptions(['search', params])` keyed
queries; same for audit filters (P6).

### FA-6 — No router-level error/pending/notFound defaults
`router.tsx:18-25` — only `/snapshots` and `/system` define `errorComponent`. A
failed loader on `/repositories`, the node browser, `/dumps`, or `/exports` surfaces
TanStack's built-in developer error screen. **Fix:** `defaultErrorComponent`,
`defaultPendingComponent`, `defaultNotFoundComponent` on `createRouter` (P5).

### FA-7 — `apiFetch` throws plain object literals, not Errors
`lib/api/client.ts:41-47`; consumed inconsistently: `routes/system.tsx:249` checks
`error instanceof Error` (always false for API errors → users get the generic message
instead of the server one) vs `routes/snapshots.tsx:259-261` duck-typing
`isApiError`. **Fix:** `ApiError extends Error` + one exported type guard (P7).

### FA-8 — No code splitting; shiki bundled eagerly
`vite.config.ts:30-34`, `components/node-detail-panel.tsx:27-31` — all routes are
eager (no `autoCodeSplitting`), and shiki (themes + grammar + regex engine) is
statically imported at module top of node-detail-panel, loading for every visitor of
any page. **Fix:** `autoCodeSplitting: true`; lazy-import the highlighter inside
`JsonTab`.

### FA-9 — God files mixing page, dialogs, orchestration, and formatting
`components/node-detail-panel.tsx` (1,244 lines: 5 tabs + 5 dialogs + shiki +
resize/persistence), `routes/repositories.$repoId.$branch.tsx` (1,137: breadcrumbs +
4 dialogs + table + pagination), `routes/exports.tsx` (970), `routes/dumps.tsx`
(836), `routes/search.tsx` (549: search + NoQL validation + CSV export engine).
**Fix:** falls out of P2/P3 extraction.

### FA-10 — Duplicated utility helpers (no `lib/format.ts`)
`formatTimestamp` re-implemented in 6+ files (`$branch.tsx:99`, `exports.tsx:83`,
`dumps.tsx:87`, `snapshots.tsx:66`, `audit.tsx:58`, `node-detail-panel.tsx:142`);
three byte formatters (`formatSize`/`formatBytes`/`formatFileSize`); date-suffix
generator ×3; `getParentPath` ×2. **Fix:** `lib/format.ts` (P4).

### FA-11 — Dead grid-view toggle in three routes
`routes/repositories.index.tsx:250`, `routes/repositories.$repoId.index.tsx:261`,
`routes/repositories.$repoId.$branch.tsx:855` — `viewMode` state styles two toggle
buttons but no grid rendering exists. Pure dead UI shipped to users. (= FQ-1.)

## Low

- **FA-12** — Query-key namespace footguns: `['tasks', taskId]` vs `['tasks','list']`
  share a prefix; `['nodes']` vs `['node-detail']` split means every node mutation
  must remember two keys (one already forgotten — FA-4). A `keys.ts` factory makes
  invalidation greppable.
- **FA-13** — WS poll/event race (`use-task-progress.ts:97-99`): WS patches the task
  cache while the 1.5s poll runs; a slow poll response can overwrite newer WS-derived
  state (no ordering guard).
- **FA-14** — WebSocket churn between pages (`use-websocket.ts:37-44`): refcount hits
  0 on navigation → socket closed and reopened; events in the gap are lost. Keep the
  client alive with a linger timeout or scope to app lifetime.
- **FA-15** — Cross-feature i18n key reuse: `exports.tsx:177,738` reuse
  `dump.result.errors` / `dump.action.selectZip` — renaming dump keys silently breaks
  exports. Also `search.tsx:60-68` CSV headers are hardcoded English.
- **FA-16** — Dead code: `types/api.ts:11-16` `PaginatedResponse` unused; server
  accepts a `subscribe` WS message the client never sends (SRV-16); stale
  `biome-ignore` comments (`node-detail-panel.tsx:437`, `node-versions-tab.tsx:170`).
- **FA-17** — Default-count drift: `nodesQueryOptions` key fallback `?? 25`
  (`lib/api/nodes.ts:58`) duplicates the route schema default `DEFAULT_COUNT = 25`
  (`$branch.tsx:88`); changing one desyncs cache keys.
- **FA-18** — Pagination drops `nodeId` (`$branch.tsx:1073-1095`): next/prev rebuilds
  search without `nodeId`, silently closing the open detail panel. (= FQ-15.)
- **FA-19** — Config read crashes pre-React (`lib/i18n.ts:8`): `getConfig()` at
  import time; a missing config element throws before any error UI can mount.

## Info

- **NoQL module: good design.** Pure functions, zero UI imports, full grammar
  coverage, typo suggestions, tested. Two extensibility notes: `tokenize` returning
  `Token[] | ValidationError` forces `Array.isArray` discrimination (a result object
  would be cleaner), and the validator produces no AST — future
  autocomplete/highlighting will require emitting nodes rather than throwing.
- **Loader + `ensureQueryData` + `useSuspenseQuery`** is consistently and correctly
  applied, including `loaderDeps` on the node browser.
- **Events page architecture is appropriate**: ref-buffered stream, capped buffer,
  200ms snapshot — correctly keeps a high-frequency feed out of React state and the
  query cache (but see FQ-4 for the implementation bug).
- Header/StatusBar route-title matching via `location.pathname.startsWith(...)` works
  with the basepath (verified against router-core 1.171), but duplicates route data —
  `useMatches` + route `staticData` would be self-maintaining.

## Restructuring proposals

- **P1 — Shared DTO layer (M).** Single source for `NodeEntry`, `TaskInfo`, `Dump`,
  `ExportEntry`, `Snapshot`, `DataKitConfig`, `ServerMessage`; imported type-only by
  server handlers and (via `z.infer` or directly) by client API modules. Optionally
  validate in `apiFetch` in dev builds. (= SRV-R3.)
- **P2 — `useTaskRunner` hook + `TaskCompletionDialog` (M).** Encapsulate
  `ActiveTask`, the one-shot terminal effect, invalidation, progress, and the
  running/completed dialog pair; dumps and exports each shrink ~150 lines and
  converge. Fold WS-aware refetch suppression into `taskQueryOptions` (fixes FA-1's
  polling half; terminal-only debounced list invalidation fixes the other).
- **P3 — `components/node-actions/` feature module (M).** One file per dialog
  (Rename/Move/Push/Create/Delete) consuming `{repoId, branch, node}`, used by both
  table RowActions and panel PanelActions. Split `node-detail-panel.tsx` into
  `node-detail/` (panel shell, tabs, json-tab with lazy shiki).
- **P4 — `lib/format.ts` + `lib/api/keys.ts` (S).** Consolidate
  timestamp/bytes/date-suffix/parent-path helpers; query-key factory so invalidations
  are greppable and FA-4-class omissions become obvious.
- **P5 — Router hardening (S).** `defaultErrorComponent` (generalize SnapshotsError),
  `defaultPendingComponent`, `notFoundComponent`, `autoCodeSplitting: true`.
- **P6 — URL-first state for Search and Audit (M).** `validateSearch` schemas +
  cached `queryOptions` instead of mutation-held results; shareable links,
  back/forward, cache reuse for free.
- **P7 — `ApiError` class in `lib/api/client.ts` (S).** `extends Error`, carries
  `status`/`code`; replaces both ad-hoc narrowings.

## Overall assessment

Disciplined, modern codebase with a genuinely clean macro-structure: consistent
route → queryOptions → apiFetch layering, sound dependency direction, hard problems
(event buffering, WS reconnect, NoQL parsing) solved in well-isolated tested modules.
Two real architectural debts: repetition (dialogs, task scaffolding, formatters
copy-pasted across 800–1,250-line feature files) and a fully trust-based
client/server contract with zod sitting unused at the boundary. The task-progress
subsystem works but layers polling, WS patching, and event-driven invalidation
without coordination — redundant request load exactly when the server is busiest.
Address P1–P3 and the codebase scales cleanly; defer them and each new resource page
clones another 800-line file.
