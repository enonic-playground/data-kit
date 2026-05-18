# Data Kit Implementation Plan

## Context

**data-kit** (`com.enonic.app.datakit`) is an Enonic XP 8 admin tool for browsing and managing XP data: repositories, branches, nodes, properties, versions, snapshots, dumps, exports, audit logs, events, and system info. The project scaffold is complete (React 19, Tailwind CSS 4, Vite + esbuild, Biome, Vitest, Gradle), but the app has no features yet -- just a bare `<h1>Data Kit</h1>`.

This plan covers every step needed to reach 100% feature completeness: 24 issues organized into 6 phases, each building on the previous.

**Key architecture decisions:**

- Backend APIs use the XP 8 `apis/` directory pattern (XML descriptor + TS controller)
- Snapshots and dumps go through `lib-http-client` to the XP Management API (port 4848)
- TanStack Router (file-based, type-safe) + TanStack Query (caching, mutations)
- shadcn/ui components (Radix primitives) + Lucide icons + Sonner toasts
- Dark mode from day one (Tailwind `class` strategy)
- i18n-ready structure, English only initially

---

## Phase 1: Foundation

### Issue 1 -- `chore: install core frontend and backend dependencies`

Install all packages the project needs.

**Frontend (pnpm):**

- Routing: `@tanstack/react-router`, `@tanstack/react-router-vite-plugin`, `@tanstack/react-router-devtools`
- Data: `@tanstack/react-query`, `@tanstack/react-query-devtools`, `@tanstack/react-table`
- UI: `@radix-ui/*` (dialog, dropdown-menu, select, checkbox, tooltip, tabs, scroll-area, separator, alert-dialog, label, slot), `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `sonner`
- Validation: `zod`
- Syntax highlighting: `shiki`

**Backend (build.gradle):**

- `lib-node`, `lib-repo`, `lib-auth`, `lib-context`, `lib-io`, `lib-export`, `lib-auditlog`, `lib-websocket`, `lib-http-client`, `lib-task`, `lib-event`, `lib-i18n`
- Type packages: `@enonic-types/lib-node`, `@enonic-types/lib-repo`, `@enonic-types/lib-auth`, `@enonic-types/lib-context`, `@enonic-types/lib-io`, `@enonic-types/lib-export`, `@enonic-types/lib-auditlog`, `@enonic-types/lib-websocket`, `@enonic-types/lib-event`, `@enonic-types/lib-task`, `@enonic-types/lib-i18n`
- Note: `lib-http-client` types may need manual `.d.ts` if not available on npm

**Files modified:** `package.json`, `build.gradle`, `src/main/resources/tsconfig.json` (verify path mappings work for new libs), `esbuild.server.js` (add `/lib/http-client` to externals if not covered by `/lib/xp/*`)

**Acceptance:** `pnpm build` and `pnpm check` pass. All packages resolve.

---

### Issue 2 -- `chore: set up config injection, theme system, and base utilities`

Replace the current `data-*` attribute config injection with the standard JSON-in-script-tag pattern used by other Enonic admin apps. Set up theming and core utilities.

**Config injection:**

- Update `main.ts` controller: compute full config JSON (appId, assetsUri, toolUri, API URLs via `portal.apiUrl()`, launcher widget URL, current user) and inject into template
- Update `main.html`: add `<script type="application/json" id="datakit-config">{{{configAsJson}}}</script>`, update bundle script tag to use `data-config-script-id="datakit-config"`
- Update `main.yml`: add custom API names to the `apis:` list as they're created in later issues
- Create `assets/js/lib/config.ts`: reads config from the JSON script tag at bootstrap time

**Theme system:**

- In `assets/styles/main.css`: define CSS custom properties for theme tokens (background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring) with light defaults and `.dark` overrides
- Create `assets/js/components/theme-provider.tsx`: reads/persists theme preference to localStorage, toggles `.dark` class on `<html>`

**Utilities:**

- Create `assets/js/lib/utils.ts`: `cn()` function (clsx + tailwind-merge)
- Create `assets/js/types/api.ts`: `ApiResponse<T>`, `ApiError`, `PaginatedResponse<T>`, common entity types

**Files created:** `lib/config.ts`, `lib/utils.ts`, `types/api.ts`, `components/theme-provider.tsx`
**Files modified:** `main.ts`, `main.html`, `main.css`

**Acceptance:** Config values accessible via `getConfig()`. Theme toggle works between light/dark. CSS variables render correctly in both modes.

---

### Issue 3 -- `feat: set up TanStack Router with app shell layout`

Replace the placeholder `<App>` component with a full router setup and app shell.

**Router:**

- Create `assets/js/router.tsx` with `createRouter()`, basepath from config `toolUri`, router context (queryClient, config)
- Install TanStack Router Vite plugin in `vite.config.ts` for file-based route generation
- Create `routes/__root.tsx`: app shell layout with `<Sidebar>`, `<Header>`, `<Outlet />`
- Create `routes/index.tsx`: redirect to `/repositories`
- Create placeholder route files for all sections: `repositories/`, `search.tsx`, `snapshots.tsx`, `dumps.tsx`, `exports.tsx`, `tasks.tsx`, `audit.tsx`, `events.tsx`, `system.tsx`

**App shell components (`components/layout/`):**

- `Sidebar`: collapsible navigation drawer with icon + label links for each section (Repositories, Search, Snapshots, Dumps, Exports, Tasks, Audit, Events, System). Active state styling. Collapse to icon-only mode.
- `Header`: app title/breadcrumbs slot, theme toggle button, optional launcher integration
- Update `app.tsx`: mount `RouterProvider` wrapped in `ThemeProvider`

**Files created:** `router.tsx`, `routes/__root.tsx`, `routes/index.tsx`, 9 placeholder route files, `components/layout/sidebar.tsx`, `components/layout/header.tsx`, `components/layout/app-shell.tsx`
**Files modified:** `app.tsx`, `vite.config.ts`

**Acceptance:** Sidebar links navigate between routes, URL updates with browser history, active route highlighted, shell renders in both themes.

---

### Issue 4 -- `feat: set up TanStack Query, API client, and first backend API endpoint`

Build the data fetching infrastructure and prove it end-to-end with a system info endpoint.

**Backend:**

- Create `src/main/resources/lib/api.ts`: shared server utilities -- `jsonResponse(data)`, `errorResponse(message, status)`, `getParam(req, name)`, `requireAdmin(req)` helpers
- Create `apis/system/system.xml`: API descriptor with `role:system.admin`
- Create `apis/system/system.ts`: `GET` handler returning `{ xpVersion, appVersion, appName }` from `app` global

**Frontend:**

- Create `assets/js/lib/api/client.ts`: `apiFetch<T>(endpoint, options?)` wrapper -- reads base URL from config, appends endpoint, handles `{ success }` / `{ error }` envelope, throws typed `ApiError` on failure, supports GET/POST/PUT/DELETE
- Create `assets/js/lib/api/system.ts`: `fetchSystemInfo()` + `systemInfoQueryOptions()`
- Set up `QueryClientProvider` in `app.tsx` with defaults (staleTime: 30s, retry: 1)
- Wire `routes/system.tsx` to fetch and display system info (simple card layout) as proof-of-concept

**Files created:** `lib/api.ts` (server), `apis/system/system.xml`, `apis/system/system.ts`, `lib/api/client.ts`, `lib/api/system.ts`
**Files modified:** `app.tsx`, `routes/system.tsx`, `main.yml` (add `system` to apis list)

**Acceptance:** Deploying to XP sandbox, navigating to System page shows version info fetched from the API. TanStack Query devtools visible in dev.

---

### Issue 5 -- `feat: add shadcn/ui base component library`

Add the foundational UI components that all feature views depend on. Every component follows project conventions: arrow functions, `displayName`, `data-component`, `className` as last `cn()` argument.

**Components to create in `assets/js/components/ui/`:**

- Layout: `Card`, `Separator`, `ScrollArea`, `Skeleton`
- Forms: `Button` (with cva variants), `Input`, `Label`, `Textarea`, `Select`, `Checkbox`
- Feedback: `Badge`, `Tooltip`, `Progress`
- Overlays: `Dialog`, `AlertDialog`, `DropdownMenu`, `Sheet` (for mobile nav)
- Data: `Table` (thead/tbody/tr/th/td styled primitives), `Tabs`
- Toast: integrate Sonner with `Toaster` component + `toast()` helper

**Shared components in `assets/js/components/shared/`:**

- `ConfirmDialog`: wraps AlertDialog for destructive action confirmation
- `ProgressDialog`: non-dismissable modal with progress bar and status text (for async tasks)
- `EmptyState`: icon + title + description + optional action button

**Files created:** ~20 component files in `components/ui/`, 3 files in `components/shared/`

**Acceptance:** All components render in both themes, pass lint/type checks, use consistent CSS variable theming.

---

## Phase 2: Core Data Browsing

### Issue 6 -- `feat: implement repository list with create and delete`

**Backend:**

- Create `apis/repositories/repositories.xml` + `repositories.ts`
- `GET`: list all repos via `repoLib.list()`, return `{ id, branches }[]`
- `POST`: create repo via `repoLib.create({ id })`, validate name
- `DELETE`: delete repo via `repoLib.delete(id)`, guard against `system-repo` and `com.enonic.cms.default`

**Frontend:**

- Create `lib/api/repositories.ts`: query options + mutation hooks
- Create `routes/repositories/index.tsx`: table with columns (name, branch count), row click navigates to branches
- "Create Repository" button with dialog (name input, Zod validation)
- Delete action per row with `ConfirmDialog` (guards displayed for protected repos)
- Toast feedback on mutations, empty state for no repos

**Files created:** `apis/repositories/repositories.xml`, `apis/repositories/repositories.ts`, `lib/api/repositories.ts`, `routes/repositories/index.tsx`
**Files modified:** `main.yml` (add `repositories` to apis)

**Acceptance:** Repo list loads from XP, create/delete work, protected repos can't be deleted.

---

### Issue 7 -- `feat: implement branch list with create and delete`

**Backend:**

- Extend or create `apis/branches/branches.xml` + `branches.ts`
- `GET /?repoId=X`: list branches via `repoLib.get(repoId).branches`
- `POST`: create branch via `repoLib.createBranch({ repoId, branchId })`
- `DELETE`: delete branch via `repoLib.deleteBranch({ repoId, branchId })`

**Frontend:**

- Create `lib/api/branches.ts`: query options + mutations
- Create `routes/repositories/$repoId/index.tsx`: table of branches, click navigates to node browser
- Breadcrumbs: Repositories > {repoId}
- Create/delete dialogs with validation

**Files created:** `apis/branches/*`, `lib/api/branches.ts`, `routes/repositories/$repoId/index.tsx`
**Files modified:** `main.yml`

**Acceptance:** Selecting a repo shows its branches, CRUD works, breadcrumbs update.

---

### Issue 8 -- `feat: implement node browsing with flat table navigation`

Build the core data browsing experience -- flat table of child nodes with drill-down navigation.

**Backend:**

- Create `apis/nodes/nodes.xml` + `nodes.ts`
- `GET /?repoId=X&branch=Y&parentPath=Z&start=N&count=N`: connect to repo/branch via `nodeLib.connect()`, query children with `_parentPath = Z`, return `{ _id, _name, _path, hasChildren, _nodeType, _ts }`
- Support `sort` param for child ordering

**Frontend:**

- Create `lib/api/nodes.ts`: query options with search params
- Create `routes/repositories/$repoId/$branch/index.tsx` using search params `{ path, start, count }`
- TanStack Table with columns: icon (folder if hasChildren, file otherwise), name (clickable for drill-down), type, modified time
- First row is `..` when not at root (navigates to parent path)
- `Breadcrumbs` component parsing current `path` into clickable segments
- Pagination controls (prev/next, showing start-end of total)
- Loading skeleton while fetching

**Files created:** `apis/nodes/*`, `lib/api/nodes.ts`, `routes/repositories/$repoId/$branch/index.tsx`, `components/data/node-breadcrumbs.tsx`
**Files modified:** `main.yml`

**Acceptance:** Can navigate the full node tree via click-through, breadcrumbs are functional, pagination works, back button navigates correctly.

---

### Issue 9 -- `feat: implement node detail view with properties, metadata, and permissions`

**Backend:**

- Extend `apis/nodes/nodes.ts`: `GET /?repoId=X&branch=Y&key=Z` returns full node with all properties, metadata, permissions
- Create `apis/properties/properties.xml` + `properties.ts`: `POST` (add property), `PUT` (update), `DELETE` (remove) -- modifies node via `nodeLib.modify()`
- Create `apis/security/security.xml` + `security.ts`: `GET /?repoId=X&branch=Y&key=Z` returns permissions list, `PUT` updates permissions

**Frontend:**

- Create a detail panel component (slide-over or split view) with `Tabs`:
  - **Properties tab**: typed key-value table (name, type badge, value), inline edit, add/delete rows. Type selector: String, Long, Double, Boolean, DateTime, GeoPoint, Reference, BinaryReference, PropertySet, etc.
  - **Metadata tab**: read-only display of `_id`, `_name`, `_path`, `_nodeType`, `_childOrder`, `_ts`, `_state`, `_versionKey`
  - **Permissions tab**: ACL entries table (principal, allow operations, deny operations), edit mode toggle
  - **JSON tab**: full node data with Shiki syntax highlighting
- Create `components/data/json-view.tsx`: Shiki-powered syntax highlighted JSON display
- Create `components/data/property-editor.tsx`: typed property editing with type-aware input fields

**Files created:** `apis/properties/*`, `apis/security/*`, `lib/api/properties.ts`, `lib/api/security.ts`, `components/data/node-detail.tsx`, `components/data/json-view.tsx`, `components/data/property-editor.tsx`
**Files modified:** `apis/nodes/nodes.ts`, `main.yml`

**Acceptance:** Clicking a node opens detail view, all tabs render correctly, property CRUD works, JSON is syntax-highlighted, permissions display correctly.

---

### Issue 10 -- `feat: implement node actions (create, rename, move, delete, push)`

**Backend:**

- Extend `apis/nodes/nodes.ts`:
  - `POST`: create child node (parentPath, name, optional nodeType)
  - `PUT /?action=rename`: rename node via `nodeLib.move({ source, target: newName })`
  - `PUT /?action=move`: move node via `nodeLib.move({ source, target: newParentPath })`
  - `DELETE`: delete node(s) by key -- run as async task via `taskLib.executeFunction()` for bulk operations
  - `POST /?action=push`: push node to target branch via `nodeLib.push({ key, target, resolve: true, includeChildren })`

**Frontend:**

- Add toolbar actions and row context menu (DropdownMenu) to node browser
- Dialogs: "New Child" (name + optional type input), "Rename" (name input, prefilled), "Move" (target path input), "Delete" (AlertDialog with node path), "Push" (branch selector + options: include children, resolve dependencies)
- All mutations invalidate node list queries
- Toast feedback for success/error

**Files modified:** `apis/nodes/nodes.ts`, node browser route, add dialog components

**Acceptance:** All five actions work end-to-end, input validation, toasts on completion, list refreshes.

---

### Issue 11 -- `feat: implement binary download and reference navigation`

**Backend:**

- Create `apis/binary/binary.xml` + `binary.ts`:
  - `GET /?repoId=X&branch=Y&key=Z&binaryReference=R`: read binary via `nodeLib.connect().getBinary()`, return as stream with `Content-Disposition: attachment` header
  - `GET /?repoId=X&branch=Y&key=Z&binaryReference=R&info=true`: return metadata only (content type, size estimate)

**Frontend:**

- In property editor, detect `BinaryReference` values: render with download icon button that triggers `window.open()` to the binary endpoint
- Detect `Reference` type values: render as clickable links that resolve the reference ID and navigate to that node in the same repo/branch (via a lookup query)
- Add small info tooltip on binary refs showing available metadata

**Files created:** `apis/binary/*`, `lib/api/binary.ts`
**Files modified:** `components/data/property-editor.tsx`

**Acceptance:** Binary refs show download button that downloads the file. Reference values are clickable and navigate to the correct node.

---

## Phase 3: Search & Versions

### Issue 12 -- `feat: implement NoQL search with results table`

**Backend:**

- Create `apis/search/search.xml` + `search.ts`:
  - `POST` with `{ query, repoId?, branch?, start, count, sort, filters? }`: multi-repo search via `multiRepoConnect()` or single-repo via `nodeLib.connect().query()`. Return `{ _id, _name, _path, _score, _repoId, _branch, _nodeType }[]` + total

**Frontend:**

- Create `routes/search.tsx` with Zod-validated search params (`query`, `repo`, `branch`, `start`, `count`, `sort`)
- Search form: repo selector dropdown (from repos API, with "All" option), branch selector, query textarea, submit button
- Results table (TanStack Table): score, name, path (clickable -- navigates to node detail), repo, branch, type. Column header sorting
- Pagination. Query execution time display. "Clear" button
- Empty state and error handling for invalid queries

**Files created:** `apis/search/*`, `lib/api/search.ts`, `routes/search.tsx`
**Files modified:** `main.yml`

**Acceptance:** Search returns results from XP, pagination and sorting work, clicking a result navigates to that node.

---

### Issue 13 -- `feat: add search result export as CSV/TSV`

Client-side feature that re-fetches all matching results and exports them as a file.

- Create `assets/js/lib/export.ts`: `toCSV(rows, columns)` and `toTSV(rows, columns)` functions. Generate string, create `Blob`, trigger download via `URL.createObjectURL()`
- Add "Export CSV" / "Export TSV" buttons to search results toolbar (visible when results exist)
- For large result sets: paginate through all pages (up to configurable limit, e.g. 10,000), show progress

**Files created:** `lib/export.ts`
**Files modified:** `routes/search.tsx`

**Acceptance:** Export buttons produce correctly formatted files, large exports show progress indicator.

---

### Issue 14 -- `feat: implement node version management`

**Backend:**

- Create `apis/versions/versions.xml` + `versions.ts`:
  - `GET /?repoId=X&nodeId=Z&start=N&count=N`: list versions via `nodeLib.findVersions()`, return `{ versionId, timestamp, commitId }[]` + total
  - `PUT /?repoId=X&branch=Y&nodeId=Z&versionId=V`: set active version via `nodeLib.setActiveVersion()`

**Frontend:**

- Add "Versions" tab in node detail view
- Table: version ID (truncated with copy), timestamp (formatted), commit ID, active badge
- "Set Active" button on non-active versions with confirmation dialog
- Version count shown in tab label

**Files created:** `apis/versions/*`, `lib/api/versions.ts`
**Files modified:** `components/data/node-detail.tsx`, `main.yml`

**Acceptance:** Version list loads for any node, set active works, currently active version visually indicated.

---

## Phase 4: Backup & Data Management

### Issue 15 -- `feat: implement snapshot management via Management API`

**Backend:**

- Create `src/main/resources/lib/management-api.ts`: shared wrapper for `lib-http-client` calls to `localhost:4848`. Handle auth (JWT or basic), response parsing, error mapping
- Create `apis/snapshots/snapshots.xml` + `snapshots.ts`:
  - `GET`: list snapshots via Management API `GET /api/repo/snapshot/list`
  - `POST`: create snapshot via `POST /api/repo/snapshot`
  - `POST /?action=restore`: restore via `POST /api/repo/snapshot/restore`
  - `DELETE`: delete via `POST /api/repo/snapshot/delete`

**Frontend:**

- Create `routes/snapshots.tsx`: table of snapshots (name, timestamp, indices)
- "Create Snapshot" button with repo selector dialog
- "Restore" with warning AlertDialog (destructive action)
- "Delete" with ConfirmDialog
- Toast feedback, loading states

**Files created:** `lib/management-api.ts`, `apis/snapshots/*`, `lib/api/snapshots.ts`, `routes/snapshots.tsx`
**Files modified:** `main.yml`

**Acceptance:** Snapshot CRUD works, restore shows prominent warning, operations execute against real Management API.

---

### Issue 16 -- `feat: implement dump management (list, create, load, delete)`

**Backend:**

- Create `apis/dumps/dumps.xml` + `dumps.ts`:
  - `GET`: list dumps via Management API `POST /api/system/dump` (list variant) or by reading dump directory
  - `POST`: create dump with options (name, includeVersions, archive, maxVersions, maxAge) -- async task
  - `POST /?action=load`: load dump -- async task with progress
  - `DELETE`: delete dump
  - `POST /?action=upgrade`: upgrade dump format

**Frontend:**

- Create `routes/dumps.tsx`: table (name, timestamp, XP version, model version, size, loadable indicator)
- "Create Dump" dialog with options: name, include version history toggle, archive toggle, max versions, max age
- "Load" with warning AlertDialog + ProgressDialog polling task status
- "Delete" with ConfirmDialog
- "Upgrade" button for older formats
- Show compatibility warnings for mismatched versions

**Files created:** `apis/dumps/*`, `lib/api/dumps.ts`, `routes/dumps.tsx`
**Files modified:** `main.yml`

**Acceptance:** Dump CRUD works, create/load show progress, destructive actions have warnings.

---

### Issue 17 -- `feat: add dump and export upload/download`

Extend dumps and exports with file transfer capabilities. This issue may require Java beans for ZIP operations -- if not feasible with pure JS, document the limitation and implement a simplified version.

**Backend:**

- Extend `apis/dumps/dumps.ts`: download (archive dump dir to stream), upload (multipart file, extract to dump dir)
- Extend `apis/exports/exports.ts` (from issue 18): same download/upload pattern

**Frontend:**

- Add "Download" button per dump/export (triggers file download)
- Add "Upload" button in toolbar (file input accepting .zip)
- Upload progress indicator

**Files modified:** `apis/dumps/dumps.ts`, `apis/exports/exports.ts`, `routes/dumps.tsx`, `routes/exports.tsx`

**Acceptance:** Download produces valid archive, upload + load cycle works, progress indicators function.

---

### Issue 18 -- `feat: implement export/import management`

**Backend:**

- Create `apis/exports/exports.xml` + `exports.ts`:
  - `POST`: export nodes via `exportLib.exportNodes({ sourceNodePath, exportName, ... })` -- async task
  - `POST /?action=import`: import nodes via `exportLib.importNodes({ source, targetNodePath, ... })` -- async task
  - `GET`: list existing exports (read from export directory)
  - `DELETE`: remove export

**Frontend:**

- Create `routes/exports.tsx`: table (name, timestamp, node count)
- "Create Export" dialog: source repo, branch, node path, export name
- "Import" dialog: target repo, branch, node path, select existing export
- "Delete" with ConfirmDialog
- Progress indicators for create/import operations

**Files created:** `apis/exports/*`, `lib/api/exports.ts`, `routes/exports.tsx`
**Files modified:** `main.yml`

**Acceptance:** Export creates named export, import loads into target, list refreshes correctly.

---

## Phase 5: Monitoring & System

### Issue 19 -- `feat: implement WebSocket infrastructure and task monitoring`

**Backend:**

- Create `apis/events/events.xml` + `events.ts`: WebSocket endpoint using `lib-websocket`. On open, register client. Forward XP server events (task progress, node changes) as JSON messages. Support subscription messages from client for filtering
- Create `apis/tasks/tasks.xml` + `tasks.ts`: `GET` lists tasks via `taskLib.list()` with state and progress info

**Frontend:**

- Create `assets/js/lib/websocket.ts`: `WebSocketClient` class -- manages connection, auto-reconnect with exponential backoff, heartbeat
- Create `assets/js/lib/hooks/use-websocket.ts`: React hook wrapping the WebSocket client
- Create `assets/js/lib/hooks/use-task-progress.ts`: hook that subscribes to task events and merges progress into TanStack Query cache
- Refactor `components/shared/progress-dialog.tsx` to use real-time WebSocket task events with REST fallback
- Create `routes/tasks.tsx`: table (name, state badge, progress bar, start time, duration). Auto-updates via WebSocket

**Files created:** `apis/events/*`, `apis/tasks/*`, `lib/websocket.ts`, `lib/hooks/use-websocket.ts`, `lib/hooks/use-task-progress.ts`, `lib/api/tasks.ts`, `routes/tasks.tsx`
**Files modified:** `main.yml`, `components/shared/progress-dialog.tsx`

**Acceptance:** Task list auto-updates, progress bars animate in real-time, WebSocket reconnects after disconnection.

---

### Issue 20 -- `feat: implement audit log viewer`

**Backend:**

- Create `apis/audit/audit.xml` + `audit.ts`:
  - `GET /?from=X&to=Y&type=T&user=U&start=N&count=N`: query via `auditLogLib.find()`, return entries with `{ id, type, source, user, objectUris, timestamp, data }`

**Frontend:**

- Create `routes/audit.tsx`: filterable table
- Filter bar: date range (two date inputs), event type dropdown, user/principal input
- Table columns: timestamp (formatted), type (badge), user, source, objects (truncated)
- Row expansion showing full audit entry data as JSON (via `JsonView`)
- Pagination

**Files created:** `apis/audit/*`, `lib/api/audit.ts`, `routes/audit.tsx`
**Files modified:** `main.yml`

**Acceptance:** Audit entries load, filters narrow results, expanded view shows full data, pagination works.

---

### Issue 21 -- `feat: implement real-time event stream viewer`

**Frontend-only** (reuses WebSocket endpoint from issue 19):

- Create `routes/events.tsx`: real-time scrolling event log
- Controls: play/pause toggle, clear, filter by event type (checkboxes: node, task, application, repository, custom)
- Event display: timestamp, type (color-coded badge), source, summary. Row expansion for full payload (JSON)
- Limit to last N events (default 500), counter showing total received
- Use ref-based circular buffer to avoid re-renders on every event

**Files created:** `routes/events.tsx`

**Acceptance:** Events stream in real-time, play/pause works, filters narrow visible events, performance acceptable.

---

### Issue 22 -- `feat: complete system info page`

Extend the proof-of-concept system page from issue 4 with full information.

**Backend:**

- Extend `apis/system/system.ts`: add Java version, OS info, XP home directory. Optionally add disk space (may need Java bean -- if not feasible, skip and note as future enhancement)

**Frontend:**

- Update `routes/system.tsx`: card-based layout with info sections (XP version, home dir, app version, Java runtime, OS)
- Optional disk space visualization bar if backend supports it
- Theme settings section
- Link to Enonic documentation

**Files modified:** `apis/system/system.ts`, `routes/system.tsx`

**Acceptance:** System page shows comprehensive info, works in both themes.

---

## Phase 6: Widget & Polish

### Issue 23 -- `feat: implement Content Studio export widget`

Standalone widget that runs inside Content Studio's context panel. It's a separate small UI, not part of the main React app.

**Backend:**

- Create `admin/widgets/export/export.yml`: widget descriptor with `role:system.admin`, interface `contentstudio.contextpanel`
- Create `admin/widgets/export/export.ts`: controller that reads Content Studio context params (repository, branch, contentId), resolves content path, renders widget HTML
- Create `admin/widgets/export/export.html`: minimal Mustache template with inline styles (or a small CSS include)
- Reuse export API from issue 18 for the actual export operation

**Frontend (widget-specific, minimal):**

- Small form: export name input, "Export" button
- Progress indicator during export
- Success/error display
- No React needed -- can be plain HTML/JS or a very small script

**Files created:** `admin/widgets/export/export.yml`, `admin/widgets/export/export.ts`, `admin/widgets/export/export.html`

**Acceptance:** Widget appears in Content Studio context panel, export works, progress shown.

---

### Issue 24 -- `feat: add i18n scaffolding, polish, and loading states`

Final polish pass across the entire application.

**i18n:**

- Create `assets/js/lib/i18n.ts`: simple translation function reading from a loaded phrases map (fetch from `lib-i18n` API or bundle phrases). English-only initially, but all user-facing strings go through `t()` calls
- Add `i18n/phrases.properties` entries for all section names, action labels, dialog titles, error messages

**Loading & error states:**

- Add `Skeleton` loading states to all list views (repos, branches, nodes, snapshots, dumps, exports, tasks, audit)
- Add error boundary component with retry button for route-level errors
- Add empty state components for all list views

**Accessibility & polish:**

- Ensure all dialogs trap focus and close on Escape
- Add ARIA labels to icon buttons, tables, navigation
- Keyboard navigation: Tab through sidebar items, Enter to activate
- Verify both themes are consistent across all pages, no visual regressions
- Add help tooltips on complex features (NoQL syntax, dump options)

**Files created:** `lib/i18n.ts`, `components/shared/error-boundary.tsx`
**Files modified:** All route files (add loading/error/empty states), `i18n/phrases.properties`

**Acceptance:** All pages have loading skeletons, error boundaries, empty states. i18n function wraps all strings. Keyboard navigation works through the app.

---

## Dependency Graph

```
1 ─┬─ 2 ─┬─ 3 ─┐
   │      ├─ 4 ─┤─── 6 ── 7 ── 8 ── 9 ─┬─ 10
   │      └─ 5 ─┘                        ├─ 11
   │                                      └─ 14
   │
   │      4,5 ─┬─ 12 ── 13
   │           ├─ 15
   │           ├─ 16 ── 17
   │           ├─ 19 ── 21
   │           ├─ 20
   │           └─ 22
   │
   │      6 ──── 18 ── 17 (shared upload/download)
   │
   │      19 ─── progress infrastructure for 15,16,18
   │
   └── 23 (widget, independent after backend APIs exist)
       24 (polish, last)
```

**Parallel opportunities:**

- Issues 3, 4, 5 can run in parallel after 1-2
- Issues 12-22 (Phase 3-5) can mostly run in parallel after Phase 2 core is done
- Issue 23 (widget) is independent once export API exists

---

## Deferred / Future Enhancements

These are intentionally excluded from the plan:

- **Raw blob inspection**: needs Java bean for `BlobStore` access. Low priority niche feature
- **Index document viewer**: needs direct Elasticsearch access. Deferred until need confirmed
- **Version comparison**: visual diff between two node versions. Can be added after issue 14
- **Dashboard widget**: tentative second widget for XP dashboard. Decide after main tool is complete
- **Advanced report generation**: ZIP-packaged reports with custom fields. Needs Java for ZIP creation
- **Custom displayed fields**: configurable columns in node browser. Nice-to-have, add after core works
- **Image grid view and preview**: When a folder contains image nodes, offer a grid/list toggle in the node browser toolbar. Grid mode shows image thumbnails (cover-fit, labeled with node name). Image nodes also render a full preview in the detail sidebar. Cache strategy: serve binary endpoint with `Cache-Control: max-age=3600` keyed by versionKey for content correctness; rely on TanStack Query's staleTime for query-level caching; avoid re-encoding Blob URLs on repeat visits to the same node. Detection: check `_nodeType` or a `mimeType` property on the node
- **Smart Move-to path autocomplete with path constructor**: Replace the plain path input in the Move dialog with an intelligent autocomplete that loads up to 10 child folders at the current path segment and filters by name as the user types. Cache previously-fetched path segments (keyed by path string) to skip redundant requests when the user types and deletes characters. Add an optional path constructor toggle: a horizontal scrollable bar (macOS Finder-style) showing clickable path segments, each opening a dropdown of sibling folders; the rightmost segment shows children of the current folder so the user can drill down without typing

---

## Verification

After each issue, verify:

1. `pnpm check` passes (lint + types + tests)
2. `./gradlew build -Penv=dev` produces a deployable JAR
3. Deploy to XP sandbox and manually test the new feature
4. Both light and dark themes render correctly
