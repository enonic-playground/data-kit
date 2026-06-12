# Frontend Component & Code Quality

Component-level findings for `assets/js/` (components, routes, hooks). Architecture
and data-layer findings live in [03-frontend-architecture.md](03-frontend-architecture.md).

## High

### FQ-1 — Dead view-mode toggle UI in three routes
`routes/repositories.index.tsx:250,301-318`, `routes/repositories.$repoId.index.tsx:261,306-323`,
`routes/repositories.$repoId.$branch.tsx:855,961-978`

`viewMode` state is set by the List/Grid buttons and used only to highlight the
active button — no grid rendering exists anywhere. Users get two clickable buttons
where one does literally nothing. Implement the grid view or remove the toggle (and
the triplicated block). (= FA-11.)

### FQ-2 — Icon-only buttons have no accessible names (12 occurrences, 0 labeled)
All `<Button variant="ghost" size="icon">` row-action triggers (e.g.
`routes/dumps.tsx:330`, `routes/exports.tsx:266`, `routes/snapshots.tsx:122`,
`routes/repositories.index.tsx:108`, `routes/repositories.$repoId.index.tsx:112`,
`routes/repositories.$repoId.$branch.tsx:594`), the search submit/clear buttons
(`routes/search.tsx:384-395,405-412`), and the view-mode toggles render only a lucide
icon with no `aria-label`. Only 2 `aria-label`s exist across all routes.
**Fix:** add `aria-label` (and `aria-pressed` for toggles); `node-detail-panel.tsx:645`
already does it correctly — copy that pattern.

### FQ-3 — Clickable table rows are mouse-only
`routes/repositories.$repoId.$branch.tsx:1002-1034`, `routes/repositories.index.tsx:344-354`,
`routes/repositories.$repoId.index.tsx:342-363`, `routes/audit.tsx:84-89`

Navigation and row-expansion bound to `<tr onClick>` with `cursor-pointer` — no
`tabIndex`, no key handling, no `role`. Keyboard users cannot browse nodes, open
repos, or expand audit entries. `events.tsx:110-137` and `node-versions-tab.tsx:208`
show the correct pattern (a real `<button>` with `aria-expanded`).
**Fix:** apply that pattern, or add a focusable primary-action element per row.

### FQ-4 — Events page re-render storm with unmemoized 500-row list
`routes/events.tsx:192-201,231-236,321-325`

The 200ms interval calls `setSnapshot` with a fresh `slice()` every tick even when
nothing arrived, re-rendering the entire page 5×/sec; `EventRow` is not memoized, so
up to 500 rows re-render each tick; `visibleEvents` re-filters+reverses each time.
**Fix:** skip `setSnapshot` when the buffer is unchanged, `memo(EventRow)` (its
`event` prop is referentially stable), consider virtualization for the 500-row cap.

### FQ-5 — Panel width persistence is race-dependent and effectively broken
`components/node-detail-panel.tsx:1203-1205`

`writeStoredWidth` runs in a `[width]` effect guarded by
`dragStateRef.current == null`. During a drag every effect run is skipped (ref is
set), and on `mouseup` no state changes, so the final width is never written —
persistence only works via the double-click reset path.
**Fix:** write the width in `handleUp` (line 1188) instead of an effect.

## Medium

### FQ-6 — Column definitions recreated every render in 7 of 8 tables
`routes/dumps.tsx:669-699`, `routes/exports.tsx:801-830`, `routes/snapshots.tsx:339-369`,
`routes/tasks.tsx:71-121`, `routes/repositories.index.tsx:252-279`,
`routes/repositories.$repoId.index.tsx:264-279`, `routes/repositories.$repoId.$branch.tsx:888-939`

Fresh `columns` arrays each render bust TanStack Table's row-model memoization. Only
`search.tsx:267-324` memoizes on `[t]`. Tables are small so impact is modest, but
it's the documented misuse. **Fix:** hoist/`useMemo` columns consistently (include
captured `repoId`/handlers in deps or pass via `meta`).

### FQ-7 — Shared WebSocket torn down and rebuilt on every route change
`lib/hooks/use-websocket.ts:37-44` — `releaseClient` closes the singleton when the
last consumer unmounts; navigating tasks → exports → events closes/reopens the socket
each time, losing events and churning reconnect state. (= FA-14.)
**Fix:** linger timeout or app-lifetime scope.

### FQ-8 — `useTasksListRefresh` invalidates on every task event, unthrottled
`lib/hooks/use-task-progress.ts:111-123` — every `task.updated` (many per second
during a dump) triggers `invalidateQueries(['tasks','list'])` → refetch. (= FA-1.)
**Fix:** debounce/throttle, or patch the cache the way `useTaskProgress` does.

### FQ-9 — Mutation results mirrored into local state; pointless `useCallback`
`routes/search.tsx:100-133,135-155`

`result`/`error` are copied out of `useMutation` callbacks into `useState` instead of
reading `searchMutation.data`/`error` (two sources of truth). `doSearch`'s
`useCallback` lists `searchMutation` (new object each render) as a dep, so it
memoizes nothing. Also `value={branch || branches[0]}` (line 366) renders a value not
held in state — a semi-controlled Select; initialize `branch` when repo changes.

### FQ-10 — Task-completion choreographed via effect + ref flag, duplicated twice
`routes/exports.tsx:770-799`, `routes/dumps.tsx:635-667`

The `handledRef` + `isTaskTerminal` effect is a fragile "run once on transition"
emulation, and the two pages implement subtly different versions (dumps clears
`activeTask` when dialog closed, exports doesn't). An event handled as derived-state
sync. **Fix:** extract `useTaskCompletion(taskId, onComplete)` with transition
detection in one place (folds into FA-P2).

### FQ-11 — `ConfirmDialog` cannot represent pending state; confirm closes before mutation settles
`components/ui/confirm-dialog.tsx` + e.g. `routes/snapshots.tsx:91-104`

Radix `AlertDialogAction` auto-closes on click, so destructive confirms
(restore/delete) close immediately while the mutation is in flight — the
`setOpen(false)` calls in `onSuccess` are dead, there's no spinner/disabled state,
and failures surface only as a toast after the dialog is gone.
**Fix:** add a `pending` prop and `e.preventDefault()` in the action until the
mutation settles.

### FQ-12 — Task duration computed from `Date.now()` in render and never ticks
`routes/tasks.tsx:38-48` — running-task duration only updates when an unrelated
re-render happens (WS event). Lines 41-43 are dead logic (`elapsed` computed then
unconditionally `return '-'` for terminal states). **Fix:** interval-driven "now"
state, or drop the live pretense.

### FQ-13 — Per-row dialog mounting
`routes/repositories.$repoId.$branch.tsx:668-727` — every row mounts
Rename/Move/Push/Delete dialogs (4 Radix roots × 25 rows = 100 dialog instances).
Radix portals are lazy so cost is moderate, but the standard fix — one dialog at
table level driven by `{node, action}` state — also kills most of cluster D4.

### FQ-14 — `key={err.message}` for error lists
`routes/exports.tsx:183-188,224-229` — identical messages (common for batch failures)
produce duplicate React keys. Use index or composite key.

### FQ-15 — Pagination silently closes the node detail panel
`routes/repositories.$repoId.$branch.tsx:1072-1095` — prev/next navigate with
`search: { path, start, count }`, dropping the optional `nodeId`. Spread `prev` like
`openNodeDetail` does. (= FA-18.)

### FQ-16 — Resize handle is keyboard-inert
`components/node-detail-panel.tsx:1223-1233` — a focusable `<button
aria-label="resize">` that only responds to mouse drag/double-click. Add arrow-key
width adjustment, or it's a misleading a11y affordance.

## Low

- **FQ-17** — Stale `biome-ignore` suppressions after the Oxlint migration:
  `components/node-detail-panel.tsx:437`, `components/node-versions-tab.tsx:170`.
- **FQ-18** — Dead UI components: `components/ui/sheet.tsx` (187 lines),
  `scroll-area.tsx`, `textarea.tsx` have zero importers.
- **FQ-19** — Dead `defaultTheme` prop (`components/theme-provider.tsx`):
  `getStoredTheme()` never returns nullish, so `?? defaultTheme` can't trigger.
- **FQ-20** — Dead try/catch around `new Date()` in `formatTimestamp` (6 files); the
  constructor never throws. `audit.tsx:58-61` does it right
  (`Number.isNaN(d.getTime())`).
- **FQ-21** — Manual `COLUMN_COUNT` constants (`routes/exports.tsx:158`,
  `routes/dumps.tsx:161`) hand-synced with column arrays (the `// ?` comments admit
  it). Derive from `columns.length`.
- **FQ-22** — JsonTab staleness (`node-detail-panel.tsx:406-431`): switching nodes
  leaves the previous node's highlighted JSON visible until re-highlight resolves;
  `resolveTheme` reads `matchMedia` once per effect, so OS theme flips under `system`
  don't re-highlight.
- **FQ-23** — CSV export fetches aren't actually abortable (`routes/search.tsx:199-211`):
  the `AbortController` is only checked between pages; `executeSearch` never receives
  the signal.
- **FQ-24** — Export column headers bypass i18n (`routes/search.tsx:60-68`): `'ID',
  'Score', 'Name', …` hardcoded English in the CSV/TSV. The only real i18n gap found.
- **FQ-25** — UI layer bakes in app concerns: `components/ui/dialog.tsx:11,75` and
  `alert-dialog.tsx:10` — `DialogContent` swallows all click bubbling
  (`stopPropagation`) to protect table-row `onClick` handlers, and pulls
  `useTranslation` into the primitive. Workarounds for route-level patterns living in
  the wrong layer; document or move the propagation fix to the row components.
- **FQ-26** — Repeated arbitrary Tailwind values: `text-[13px]` (~6 sites),
  `text-[10px] tracking-wider uppercase` labels, `w-[10rem]/w-[14rem]/w-[16rem]`
  filter widths in `audit.tsx`. Promote the mono-cell text style into `TableCell` or
  a `cellText` class.

## Info

- **React 19 idioms are good**: ref-as-prop everywhere, zero `forwardRef`, no legacy
  boilerplate. No `useTransition`/`useDeferredValue` anywhere — `events.tsx` and
  search pagination are the only places that would benefit.
- **Shiki usage is correct**: async `codeToHtml` in an effect with cancellation, JS
  regex engine, single lang/two themes. Nit: the highlighter initializes at module
  import even if the JSON tab is never opened (see FA-8).
- `app.tsx` renders without `<StrictMode>`, so double-effect bugs (like FQ-5) go
  unexercised in dev. Consider enabling it.
- `NodeDetailContent` (`node-detail-panel.tsx:994-1001`) runs the versions infinite
  query on panel open just for the count badge — deliberate tradeoff, fine.
- WS client (`lib/websocket.ts`) internals are solid: exponential backoff, heartbeat,
  status fan-out, proper cleanup.

## Duplication clusters

| # | Cluster | Files | Extract |
|---|---------|-------|---------|
| D1 | Upload-zip dialog (~85 lines, ~95% identical) | `exports.tsx:673-757` ↔ `dumps.tsx:540-623` | `UploadZipDialog` taking mutation + i18n key prefix |
| D2 | Active-task lifecycle (ActiveTask type, TASK_TYPE/COMPLETE_KEYS, handledRef effect, start/close handlers, progress row, completion dialog) | `exports.tsx:106-160,763-959` ↔ `dumps.tsx:113-161,629-829` | `useActiveTask()` + `TaskCompletionDialog` + `TaskProgressRow` |
| D3 | Task result parsing/summary (3 near-identical parsers + summary components) | `exports.tsx:125-235`, `dumps.tsx:136-220` | `parseTaskResult<T>(info, guardKey)` + one summary list component |
| D4 | Node CRUD dialogs duplicated wholesale (~500 lines): create/rename/move/push/delete, identical validation/toasts/reset | `node-detail-panel.tsx:456-973` ↔ `repositories.$repoId.$branch.tsx:186-844` | shared `Node*Dialog` set in `components/node-actions/` |
| D5 | Create-name dialog (zod schema + input + error + toasts) | `repositories.index.tsx:165-240` ↔ `repositories.$repoId.index.tsx:173-251` | `NameFormDialog` parameterized by schema + key prefix |
| D6 | RowActions dropdown skeleton (trigger + stopPropagation items + ConfirmDialog) | 6 routes | `RowActionsMenu` driven by item-config array |
| D7 | Table render block (`getHeaderGroups().map` + `getRowModel().map` + `flexRender`, verbatim) | 8 route files | `DataTable<T>` (with `meta.className` support from `$branch`) |
| D8 | Page header bar `border-border bg-card flex h-10 shrink-0 …` div | 10 occurrences / 9 routes | `PageToolbar`/`Breadcrumbs` |
| D9 | Format helpers: `formatTimestamp` ×6, date-suffix ×3, byte formatter ×3, `getParentPath` ×2 | routes + panel + system | `lib/format.ts` (= FA-10) |
| D10 | Pagination footer (range label + Prev/Next) | `$branch:1058-1103`, `search.tsx:491-519`, `audit.tsx:260-274` | `PaginationBar` |
| D11 | WS status badge mapping (status → variant + label) | `events.tsx:239-248` ↔ `tasks.tsx:129-136` | `WsStatusBadge` |

## Overall assessment

Clean, disciplined frontend by admin-tool standards: near-total i18n, a faithful
modern shadcn/Radix wrapper layer, mostly correct hooks, no effect-for-derived-state
antipatterns in hot paths. The dominant problem is structural, not correctness: the
route layer was built by copy-paste, producing four 800–1,250-line files and eleven
duplication clusters that will rot independently — D2 and D5 have already drifted.
Fix first: dead grid toggle, width-persistence race, events render storm, and the
across-the-board a11y gaps. The `DataTable` + shared dialog/`RowActionsMenu`
extraction shrinks routes by roughly a third and fixes several Medium findings as a
side effect.
