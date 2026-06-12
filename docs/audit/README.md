# data-kit — Code Audit (2026-06-10)

Full-codebase audit ahead of a planned restructuring effort. Six parallel deep-dives
(Kotlin backend, server-side TS, frontend architecture, frontend code quality, test
suite, build/tooling), with all Critical/High findings manually re-verified against
source before publication.

## Scope and baseline

| Area | Size | Report |
|---|---|---|
| Kotlin backend (5 beans) | 724 LOC | [01-kotlin-backend.md](01-kotlin-backend.md) |
| Server-side TS (13 API handlers + lib) | 2,366 LOC | [02-server-ts.md](02-server-ts.md) |
| React client | 12,795 LOC | [03-frontend-architecture.md](03-frontend-architecture.md), [04-frontend-quality.md](04-frontend-quality.md) |
| Tests (25 files, 334 tests) | 5,014 LOC | [05-tests.md](05-tests.md) |
| Build, tooling, CI | — | [06-build-tooling.md](06-build-tooling.md) |

Baseline at audit time: **green** — `pnpm check` (Oxlint + tsgo + Vitest) passes, all
334 tests pass.

## Verdict

The codebase is disciplined and modern: correct layering on both sides (handlers →
lib → beans; routes → queryOptions → apiFetch), complete XP 8 YAML descriptor
migration, double-gated admin auth on every endpoint, near-total i18n coverage, and
genuinely strong isolated modules (NoQL parser, WebSocket client, management-api).

The debt is concentrated in four places:

1. **One real data-loss bug** in the dump/export filesystem layer (KT-1) — a single
   request can delete every dump on the server.
2. **Copy-paste as the growth strategy** — dumps/exports are ~80% duplicated on the
   server and ~85% on the client; node CRUD dialogs exist twice (~500 lines); four
   route files are 800–1,250 lines. Eleven distinct duplication clusters, several
   already diverging behaviorally.
3. **A trust-based client/server contract** — every DTO is hand-written twice; zod is
   installed but never validates a response; `as` casts on both boundaries.
4. **A test suite that protects the wrong flank** — server handlers and pure libs are
   well covered, but the API client, WebSocket state machine, task-progress reducer,
   and the two largest files in the repo (node browser, ~2.4k LOC combined) have zero
   tests. Test files are excluded from type-checking, and there is no coverage report.

## Critical / top findings

| ID | Severity | Finding |
|---|---|---|
| [KT-1](01-kotlin-backend.md#kt-1) | **Critical** | ~~`delete`/`download` with name `"."` (or `x/..`) resolves to the base directory itself — `DELETE /apis/dumps?name=.` recursively deletes **all dumps**; same in exports.~~ **Fixed 2026-06-10** (`resolveChildEntry` in Kotlin + `VALID_NAME_PATTERN` on all TS actions + rule updated). |
| [KT-2](01-kotlin-backend.md#kt-2) | High | Downloads zip entire dumps into heap (`ByteArrayOutputStream`) — multi-GB dumps OOM the XP node. |
| [KT-3](01-kotlin-backend.md#kt-3) | High | `deleteRecursively` follows directory symlinks — deletion can escape the dump/export directory. |
| [SRV-2](02-server-ts.md#srv-2) | High | Unguarded `JSON.parse(req.body)` in 6 handlers breaks the JSON error contract (XP 500 page instead of `{status,message}`). |
| [SRV-3](02-server-ts.md#srv-3) | High | `moveNode` target semantics contradict XP's move API — the primary move flow likely fails unless the user types a trailing slash. |
| [SRV-4](02-server-ts.md#srv-4) | High | Zero `log.error` calls server-side — caught errors vanish without a trace in XP logs. |
| [FA-1](03-frontend-architecture.md#fa-1) | High | Task-event invalidation storm: every `task.updated` WS tick refetches the whole task list, on top of redundant 1.5s polling that defeats its own suppression logic. |
| [FQ-2](04-frontend-quality.md#fq-2) / [FQ-3](04-frontend-quality.md#fq-3) | High | Accessibility: 12 icon-only buttons with no accessible name; row navigation is mouse-only in 4 tables. |
| [TST-1](05-tests.md#gap-1) | High (gap) | `lib/api/client.ts` — the one module every refactor touches — has zero tests; every route test mocks it away. |
| [BLD-1](06-build-tooling.md#bld-1) | High | Stale build outputs ship in locally-built jars (`emptyOutDir: false`, no clean step; a dev sourcemap is sitting in `build/resources/main` right now). |
| [BLD-2](06-build-tooling.md#bld-2) | High | Two dead compiled `admin/*.js` artifacts are committed at the repo root and hidden from lint via `ignorePatterns: ['admin/']`. Verified via `git ls-files`. |

## Cross-cutting themes

- **XC-1 — Filesystem name safety.** The `resolve().normalize().startsWith()` idiom
  misses base-dir equality, multi-segment names, and symlinks. It appears in both
  managers *and is codified as the ✅ example in `.claude/rules/kotlin.md`* — fix the
  rule together with the code (KT-1, KT-3, KT-14).
- **XC-2 — No shared client/server contract.** Six DTO families duplicated; zod unused
  at the boundary; `PaginatedResponse` dead. One shared types/schemas module fixes it
  structurally (SRV-R3, FA-P1, BLD-P5 — same proposal, three angles).
- **XC-3 — Feature cloning.** dumps↔exports cloned on server and client; node dialogs
  cloned between table and panel; create-name dialogs cloned between repo pages.
  Divergence has already started in three of these clusters.
- **XC-4 — Task-progress subsystem.** Polling, WS cache patching, and event-driven
  invalidation layered without coordination — peak request load exactly when the
  server is busiest (FA-1, FA-7, FQ-12).
- **XC-5 — Error-handling policy.** Server: inconsistent leakage (`String(e)` vs
  generic), wrong status mapping, no logging. Client: thrown object literals that fail
  `instanceof Error`. One policy + one `ApiError` class needed.
- **XC-6 — Test infrastructure holes.** Tests excluded from type-check (proven drift in
  `buildConfig`), no coverage reporting, `passWithNoTests: true`.
- **XC-7 — Dead code.** Grid-view toggle (3 routes), `PaginatedResponse`, unused UI
  components (sheet/scroll-area/textarea), committed `admin/*.js`, stale
  `biome-ignore` comments, dead `subscribe` WS contract.

## Prioritized roadmap

Implementation is planned as a separate effort. Recommended order:

**Phase 0 — Safety fixes (do immediately, independent of everything else)**
1. ~~KT-1: reject `target == baseDir` + require single-segment names in both managers;
   enforce `VALID_NAME_PATTERN` on *every* name-taking TS action (SRV-R5).~~ **Done 2026-06-10**
2. KT-3: no-follow semantics in `deleteRecursively`. — S
3. KT-2: stream archive downloads via temp file instead of heap. — S/M
4. SRV-3: fix `moveNode` target semantics (likely user-facing breakage today). — S
5. ~~Update `.claude/rules/kotlin.md` path-safety example (KT-14).~~ **Done 2026-06-10** (also added to skills-repo canonical set)

**Phase 1 — Test safety net (before any refactor)**
Fill the MUST-BEFORE-REFACTOR gaps in [05-tests.md](05-tests.md#3-coverage-gaps--prioritized-backlog):
api client, search handler, websocket client, task-progress reducer, versions handler,
node-browser destructive flows. Fix infra: type-check `src/test/**`, stub
`window.scrollTo`, add coverage reporting, fix `buildConfig`. — M/L total

**Phase 2 — Server restructure** ([02-server-ts.md](02-server-ts.md#restructuring-proposals))
Shared handler wrapper (auth + JSON parse + try/catch + logging + action allowlist),
zod request validation, shared DTO module, dumps/exports handler factory. Fixes
SRV-2/4/5/7/8/9 and halves the handler code. — M

**Phase 3 — Frontend restructure** ([03](03-frontend-architecture.md#restructuring-proposals), [04](04-frontend-quality.md#duplication-clusters))
`DataTable` + `RowActionsMenu` + shared node-action dialogs + `useTaskRunner` +
`lib/format.ts` + query-key factory + router defaults + code splitting. Shrinks routes
by roughly a third; fixes several Medium findings as a side effect. — L

**Phase 4 — Frontend correctness & a11y batch**
Small independent fixes: dead grid toggle, events-page render storm, panel-width
persistence, icon-button labels, keyboard row access, ConfirmDialog pending state,
search state to URL. — M

**Phase 5 — Build & tooling** ([06-build-tooling.md](06-build-tooling.md#restructuring-proposals))
Intermediate bundle dir + Gradle `Sync`, delete committed `admin/`, formatter in
pre-commit, CI `pull_request` trigger + caching + permissions, explicit esbuild entry
manifest, lint plugin gaps (`jsx-a11y`, `import`). — M

## What is explicitly fine (don't "fix")

- NoQL module design and its test coverage.
- The events-page ref-buffer architecture (deliberate, correct).
- Loader + `ensureQueryData` + `useSuspenseQuery` pattern.
- WebSocket client internals (backoff, heartbeat) — needs tests, not rework.
- XP 8 descriptor migration — complete and compliant.
- pnpm supply-chain posture (`minimumReleaseAge`, frozen lockfile, exact pins).
- Auth: descriptor `allow` + in-handler `requireAdmin()` on every endpoint.
