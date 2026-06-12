# Server-side TypeScript

13 API handlers (`apis/*`), shared `lib/` (api, dumps, exports, jwt, management-api,
text), admin tool entry, bean type declarations. Runs on GraalJS, bundled by esbuild
to CJS ES2023. Layering is correct (handlers → lib → beans/XP libs, no cycles), XP 8
YAML descriptors are fully compliant, and auth is enforced twice on every endpoint
(descriptor `allow: role:system.admin` + in-handler `requireAdmin()`). The structural
debt: the same auth/parse/catch boilerplate is hand-rolled 13 times with visible
drift, and every DTO shape is maintained twice (server + client).

## High

### SRV-1 — `delete`/`download` accept names resolving to the base directory ✔ verified — **FIXED 2026-06-10**
Same root cause as [KT-1](01-kotlin-backend.md#kt-1). Fixed together with it:
`VALID_NAME_PATTERN` is now enforced on every name-taking action in dumps
(download/load/upgrade/create/delete) and exports (download/delete), with handler
tests. SRV-18 is resolved by the same change.

### SRV-2 — Unguarded `JSON.parse(req.body)` in 6 handlers
`apis/branches/branches.ts:42`, `apis/repositories/repositories.ts:32`,
`apis/snapshots/snapshots.ts:31`, `apis/dumps/dumps.ts:84`,
`apis/exports/exports.ts:82`, `apis/nodes/nodes.ts:118,150,187,234,271`

Malformed JSON throws out of the handler — XP returns its generic 500 page instead of
the `{status,message,code}` body the client (`assets/js/lib/api/client.ts:42`)
expects. `search.ts:156-160` and `versions.ts:138-142` do it correctly; the rest
don't. **Fix:** one shared `parseJsonBody(req)` helper in `lib/api.ts` (see R1).

### SRV-3 — `moveNode` precondition contradicts XP move semantics
`apis/nodes/nodes.ts:300-305`

The handler requires a node to exist at `targetPath`, then calls
`repo.move({source: key, target: targetPath})`. Without a trailing slash XP treats
`target` as the *full destination path*, so the move is guaranteed to fail with
"already exists" (surfaced as a generic 500); behavior silently depends on whether
the user typed a trailing slash (client `node-detail-panel.tsx:565` passes raw
input). Likely breaks a primary UI flow today.
**Fix:** normalize to `targetPath.replace(/\/?$/, '/')` (move-into semantics) or
build the explicit destination path.

### SRV-4 — Caught errors are never logged on the server
All of `apis/*` and `lib/*` — zero `log.error`/`log.warning` calls. Handlers like
`nodes.ts:86`, `binary.ts:69`, `versions.ts:124` swallow the exception
(`catch (_e)`) and return a generic message, leaving no trace in XP logs.
**Fix:** `log.error(...)` in the shared error path (R1).

## Medium

### SRV-5 — NoQL injection in node listing
`apis/nodes/nodes.ts:51` — `` query: `_parentPath = '${parentPath}'` `` interpolates
the raw param. Caller is already admin so impact is bounded, but a stray `'` breaks
the query and the pattern invites copy-paste injection.
**Fix:** `repo.findChildren({parentKey: parentPath})` (already used for
`hasChildren`) or escape quotes.

### SRV-6 — No server-side input validation layer; `as` casts on unvalidated bodies
~30 occurrences of `body.x as string | undefined` (`nodes.ts`, `dumps.ts`,
`exports.ts`, `snapshots.ts`, `branches.ts`). Presence is checked, types are not.
zod 4 is already a runtime dependency and bundles fine into the CJS GraalJS build —
it's used only client-side today. **Fix:** zod schemas per endpoint, shared with the
client (R2/R3).

### SRV-7 — Exact-case `Authorization` header lookup
`apis/dumps/dumps.ts:83`, `apis/snapshots/snapshots.ts:15,29,59` —
`req.headers?.Authorization` misses lowercase `authorization` (HTTP/2 lowercases
header names). `@enonic-types/core` exposes a case-insensitive `getHeader()`.
**Fix:** `req.getHeader('Authorization')`.

### SRV-8 — Misleading catch-all status mapping
`apis/branches/branches.ts:65-71` maps *any* `createBranch` failure to 409; `:33-35`
and `:100-102` map any error to 404. Real failures (validation, internal errors)
masquerade as conflicts/not-found. **Fix:** inspect the error or default to 500.

### SRV-9 — Inconsistent try/catch coverage
`apis/repositories/repositories.ts:47` (`create`) and `apis/tasks/tasks.ts:19`
(`getTask`) are unwrapped — a duplicate repo ID or malformed task ID escapes as an
XP 500 HTML page, unlike sibling handlers. **Fix:** shared wrapper (R1).

### SRV-10 — Pagination parsing inconsistent and unclamped
`apis/nodes/nodes.ts:41-42` — `parseInt(getParam(...) || '0', 10)` passes `NaN` into
`repo.query` for garbage input; `audit.ts:9-14` and `versions.ts:94-95` guard
correctly. No endpoint clamps `count` (`count=100000` is accepted in
nodes/search/audit/versions). **Fix:** one `parsePagination(req, {max})` helper.

### SRV-11 — Unknown `action` values fall through to the default (mutating) operation
`apis/dumps/dumps.ts:112` (typo → creates a dump), `apis/nodes/nodes.ts:226`
(→ creates a node), `apis/snapshots/snapshots.ts:44` (→ creates a snapshot).
**Fix:** validate `action` against an allowlist; 400 on unknown (R6).

### SRV-12 — Error-detail leakage policy is inconsistent
`audit.ts:34`, `dumps.ts:47,55,79,127,147`, exports equivalents, `tasks.ts:34` return
`String(e)` (Java exception text, file paths, class names) while
`nodes.ts`/`binary.ts`/`versions.ts` return generic strings. **Fix:** one policy —
generic message out, full detail to `log.error`.

### SRV-13 — `dumps.ts` and `exports.ts` handlers are ~80% duplicated
Identical `VALID_NAME_PATTERN`, `safeFilename`, download/upload/delete/list flows.
Divergence has already started (exports validates names on import, dumps doesn't on
load/upgrade). **Fix:** shared archive-resource handler factory (R4).

## Low

- **SRV-14** — `Content-Disposition` built from raw `binaryReference`
  (`apis/binary/binary.ts:65`); no `safeFilename` unlike dumps/exports; a `"` in the
  reference breaks the header. Use the existing sanitizer.
- **SRV-15** — N+1 query in node listing (`apis/nodes/nodes.ts:69-73`): one
  `findChildren` count query per listed node (25/page).
- **SRV-16** — Dead `subscribe` message contract (`apis/events/events.ts:22`):
  `ClientMessage` declares `{type:'subscribe'}` but `handleMessage` only handles
  `ping`. Remove or implement.
- **SRV-17** — Wildcard event listener always pays serialization cost
  (`events.ts:32-50`): `JSON.stringify` of every XP event even with zero connected
  clients; also `404` for non-WS requests where `426 Upgrade Required` fits better.
- **SRV-18** — Dump names unvalidated before forwarding to the management API
  (`apis/dumps/dumps.ts:88-125`): `load`/`upgrade`/`create` send raw `name` while
  `upload` enforces the pattern. Folded into R5.
- **SRV-19** — Auth precedence: user-supplied header beats configured JWT
  (`lib/management-api.ts:84-95`). By design for Basic-auth passthrough, but if the
  URL is ever pointed off-box, admin credentials leak. Document the assumption;
  consider forwarding only when no JWT is configured.
- **SRV-20** — Stale references: `apis/versions/versions.ts:38` comment cites
  `lib-node@8.0.0-A3` (project is on 8.0.1; the `setActiveVersion` shim is still
  needed — verified absent from `node.d.ts`); `CLAUDE.md` still says
  `@enonic-types/*@8.0.0-A2`.
- **SRV-21** — Brittle error classification by message substring
  (`apis/search/search.ts:184` — `message.includes('parse')`).

## Info

- **Auth posture is good**: every API YAML carries `kind: 'API'`, `title`, and
  `allow: role:system.admin`; every handler re-checks `requireAdmin()` — proper
  defense in depth.
- **Client/server DTO duplication, no shared contract**: `DumpEntry`↔`Dump`,
  `TaskIdResponse`↔`TaskIdResult`, `NodeDto`↔`NodeEntry`, `NodesResult`↔`NodesResponse`,
  search shapes — each defined twice (`lib/dumps.ts:9` vs
  `assets/js/lib/api/dumps.ts:6`, etc.). `PaginatedResponse`
  (`assets/js/types/api.ts:11`) is dead. See R3.
- **Pagination conventions differ per endpoint**: start/count (nodes, audit, search),
  cursor (versions), none (tasks, repos, branches). Defensible per data source, but
  undocumented.
- `binary.ts:41` casts `node._attachments` to a `Record` keyed by binary reference —
  this shape isn't in `lib-node` types; assumed, not verified.
- Minor casts: `events.ts:68 as Response` (WS response type gap),
  `lib/dumps.ts:59`/`lib/exports.ts:63` `data as object` (ByteSource→InputStream
  bridge fudge, see KT-8).
- `lib/text.ts` exists solely for the 5-line `main.ts` log line — borderline
  over-abstraction.
- `system.ts:25` creates its bean per request while dumps/exports create at module
  load — harmless inconsistency (but see KT-5 where the same pattern is harmful).

## Restructuring proposals

- **R1 — Shared handler wrapper (S).** `createHandler({get, post, ...})` or
  `withAdmin(fn)` in `lib/api.ts` performing: `requireAdmin()`, safe JSON body parse,
  top-level try/catch mapping to `errorResponse` with `log.error`, consistent
  unknown-`action` 400s. Eliminates ~40 repeated guard blocks across 13 handlers;
  fixes SRV-2/4/9/11/12 in one place.
- **R2 — Server-side zod validation layer (M).** zod is already a runtime dep and is
  pure JS (works in the esbuild CJS bundle on GraalJS). Per-endpoint request schemas
  instead of `as`-casts; kills SRV-6 and centralizes the name/branch/repo-ID regexes.
- **R3 — Shared client/server contract module (M).** `src/main/resources/shared/`
  (or types mirrored via tsconfig paths) holding DTO types + zod schemas imported by
  both `apis/*` and `assets/js/lib/api/*`. Both esbuild and Vite can resolve it.
  Removes six duplicated shape families; delete dead `PaginatedResponse`.
  (= FA-P1, BLD-P5.)
- **R4 — Archive-resource handler factory (S).**
  `createArchiveHandlers({lib, label})` producing shared list/download/upload/delete
  flows; dumps/exports keep only their action-specific POST branches. ~120 duplicated
  lines removed; validation asymmetries disappear.
- **R5 — Name-safety hardening (S).** Enforce `VALID_NAME_PATTERN` on *every*
  name-taking TS operation, plus `target != baseDir` checks in the Kotlin managers.
  This is the KT-1 fix and belongs in both layers.
- **R6 — Action routing cleanup (S–M).** Either keep `?action=` but validate against
  a literal-union enum per method, or route on the API subpath (XP 8 API handlers
  receive the remaining path). Current silent fall-through to mutating defaults is
  the worst of both worlds.

## Overall assessment

A clean, disciplined server layer for its size — correct layering, compliant
descriptors, double-gated auth. The main structural debt is the absence of a shared
handler wrapper and validation layer: the same boilerplate hand-rolled 13 times with
drift already visible (unguarded `JSON.parse`, inconsistent status mapping, unlogged
errors), and every DTO maintained twice between server and client. The one genuinely
dangerous bug is the base-directory equality gap (KT-1/SRV-1); the `moveNode`
trailing-slash bug likely breaks a primary UI flow. R1+R5 are roughly a day's work
and resolve about half the findings.
