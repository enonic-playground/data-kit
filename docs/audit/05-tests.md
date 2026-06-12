# Test Suite

25 test files, 334 tests, all passing. Vitest via vite-plus; client tests use jsdom +
Testing Library. Server handler coverage is honest behavior testing; the client's
most complex modules have **zero** tests. Two silent infra holes amplify risk:
test files are excluded from type-checking, and there is no coverage reporting.

API handler coverage: 8 of 13 tested. Untested: `audit`, `events`, `search`,
`system`, `versions`. All 6 server `lib/` modules have tests.

## 1. Existing test quality

| File | Verdict | Reason |
|---|---|---|
| `apis/nodes.test.ts` | strong | 51 tests; status codes, root protection, defaults, allBranches delete; one convoluted weak test (below) |
| `apis/binary.test.ts` | strong | Real behavior: contentType from `_attachments`, Content-Disposition, info mode, full validation matrix |
| `apis/branches.test.ts` | adequate | Validation regex + protected-branch guard; test names overstate error mapping (below) |
| `apis/dumps.test.ts` | adequate | Right unit boundary (lib/dumps mocked, tested separately); good filename validation; thin routing assertions otherwise |
| `apis/exports.test.ts` | adequate | Same pattern; the path-traversal test (`../etc/passwd`, line 171) is genuinely valuable; near-clone of dumps suite |
| `apis/repositories.test.ts` | adequate | Protected-repo guards and ID validation are real behavior |
| `apis/snapshots.test.ts` | adequate | Auth-header forwarding asserted; mostly thin status mapping over mocked lib |
| `apis/tasks.test.ts` | weak | Mostly mock-echo; asserts internal call shape `{ name: null, state: null }` (line 69) |
| `lib/api.test.ts` | adequate | Small pure helpers; envelope shape is the server/client contract, so meaningful |
| `lib/dumps.test.ts` | adequate | Half mock-echo (bean pass-through), but management-API endpoint paths are the real contract |
| `lib/exports.test.ts` | strong | Cumulative progress accumulation across callbacks (119–201) — real logic |
| `lib/jwt.test.ts` | strong | Config mode resolution, validation errors, bean dispatch |
| `lib/management-api.test.ts` | strong | Best server file: auth precedence (header > JWT > Basic), URL construction, non-2xx/empty-body error paths |
| `lib/text.test.ts` | adequate | Trivial pure functions; `toTag` borderline noise but costs nothing |
| `noql/tokenizer.test.ts` | strong | Positions, error reporting, keyword/identifier disambiguation |
| `noql/validator.test.ts` | strong | Grammar, semantics, arity, typo suggestions on a 441-LOC validator — excellent refactor protection |
| `noql/suggest.test.ts` | adequate | Cutoff, case-insensitivity, empty-input edges |
| `lib/export.test.ts` (client) | strong | CSV/TSV escaping + formula-injection sanitization — security-relevant exact-output tests |
| `lib/utils.test.ts` (client) | **noise** | Tests vendor behavior of clsx + tailwind-merge; zero project logic |
| `components/header.test.tsx` | weak | 3 near-identical "h1 matches route" tests |
| `components/sidebar.test.tsx` | adequate | Collapse/expand and navigation through the real router |
| `routes/dumps.test.tsx` | weak | Read-path smoke only; no create/load/upload/delete flows |
| `routes/repositories.test.tsx` | adequate | One real interaction (create-dialog validation, 99–123); rest render-only |
| `routes/snapshots.test.tsx` | weak | Render-only; no create/restore/delete; one fragile assertion (below) |
| `routes/system.test.tsx` | adequate | Disk-usage derivation (60%), hide-when-zero, link attrs — real derived values |

### Notable findings

- **TST-INF-1 — Tests are not type-checked.** `tsconfig.json:16` includes only
  `src/main/resources/assets/**`; `check:types` covers `src/main/resources` + root
  config — `src/test/**` is in neither; Vitest only transpiles. Proof of
  consequence: `test-utils.tsx:13-35` — `buildConfig()` claims to return
  `DataKitConfig` but is missing required `apiUris.audit`, `apiUris.versions`,
  `locale`, `phrases` (cf. `lib/config.ts:6-29`). Would be a compile error.
  (= BLD-5.)
- **TST-INF-2 — `buildConfig` is dead weight:** all 6 jsdom test files inline their
  own `getConfig` mock instead, each with a *different* subset of `apiUris` keys.
  Fantasy configs that drift silently.
- **TST-INF-3 — The `{data}` envelope contract is untested client-side.** Every
  route test mocks `apiFetch` and resolves unwrapped data; `client.ts:49-50`
  (envelope unwrap) and its error mapping (`client.ts:41-47`) never execute in any
  test. The server asserts it emits `{data}`; nothing verifies the client consumes it.
- **TST-INF-4 — jsdom noise:** the 27 "Window's scrollTo not implemented" warnings
  come from TanStack Router scroll restoration. One-line fix in `setup-dom.ts`:
  `window.scrollTo = () => {};` inside the existing guard.
- **TST-INF-5 — No coverage reporting** — no `coverage` key in `vite.config.ts`, no
  `@vitest/coverage-*` dependency. For a refactor effort, you're flying without a
  gap map. Also `passWithNoTests: true` means a broken include glob silently passes
  `check` with zero tests executed (= BLD-L6).
- **TST-INF-6 — Server mock realism is decent but unenforced.** Mocks generally
  encode plausible XP shapes (both single-node and array returns of `repo.get` are
  exercised, matching real XP behavior), but pervasive `as never` casts
  (`nodes.test.ts:89` + ~30 more) plus unchecked test files mean `@enonic-types`
  drift passes silently. No shared XP mock factory — `createMockConnection`
  re-declared per file.
- `branches.test.ts:139-149` "returns 409 for duplicate branch": the handler maps
  *any* error to 409 (SRV-8); the test passes while documenting behavior that
  doesn't exist.
- `snapshots.test.tsx:150` `page.getByText('3')` — ambiguous query, matches any "3"
  on the page.
- `nodes.test.ts:867-896` "skips branches where node does not exist" —
  callCount-driven mock; never asserts the skip it's named after.
- `validator.test.ts:155` — dead `_err` variable; the comment admits the test
  mutated away from its intent.

## 2. Tests to remove or rewrite

1. **Remove** `lib/utils.test.ts` (client) — all 6 tests assert clsx/tailwind-merge
   vendor behavior.
2. **Rewrite** `snapshots.test.tsx:132-151` — scope to the row (`within(row)`), not a
   bare `getByText('3')`.
3. **Collapse** `header.test.tsx` to one parameterized test, or fold the title
   assertion into each route's own test file.
4. **Rewrite** `nodes.test.ts:867-896` — per-branch explicit mocks; assert which
   branches were skipped/failed.
5. **Loosen** `tasks.test.ts:69` — drop the `{ name: null, state: null }` argument
   assertion (implementation detail) or assert observable filtering.
6. **Refactor (mechanical, do first):** make the 6 jsdom files use a fixed
   `buildConfig()` from test-utils; hoist the duplicated `get*Page` querySelector
   helpers into test-utils; fix `buildConfig` to match `DataKitConfig`.
7. **Optional:** shared upload/download test helper for the ~150 duplicated lines
   between `apis/dumps.test.ts` and `apis/exports.test.ts`.

## 3. Coverage gaps — prioritized backlog

| # | Area | Untested behavior / refactor risk | Suggested tests | Effort | Must-before-refactor |
|---|---|---|---|---|---|
| 1 | <a id="gap-1"></a>`assets/js/lib/api/client.ts` | Envelope unwrap, error-body parse + statusText fallback, `buildUrl` encoding, `apiUpload` XHR states. Every route test mocks it away — an API-layer refactor has **zero safety net** | Unit: stub `fetch`/XHR; assert error shapes and envelope unwrap | S | **YES** |
| 2 | `apis/search/search.ts` (190 LOC) | Single- vs all-repo branching, multi-repo hit enrichment via `groups/indices/ids` bookkeeping (off-by-one minefield, 111-142), single-vs-array `repo.get` normalization, ParseException→400 | Unit, same pattern as nodes.test.ts; enrichment ordering across 2 repos, inaccessible-repo skip | M | **YES** |
| 3 | `assets/js/lib/websocket.ts` (210 LOC) | Full state machine: backoff with cap, heartbeat, `closedByUser` vs server close, status transitions, recursive `toWebSocketUrl` | Unit with `vi.useFakeTimers()` + WebSocket stub | M | **YES** |
| 4 | `assets/js/lib/hooks/use-task-progress.ts` | `applyEventToTask` merge (a dozen `??` fallbacks), event-type→state derivation, terminal invalidation — drives all dump/export progress UX | Export `applyEventToTask`/`toTaskStateFromType`, unit-test directly; one `renderHook` for cache wiring | M | **YES** |
| 5 | `apis/versions/versions.ts` (164 LOC) | Cursor pagination, commit-resolution cache, `setActiveVersion` 404 paths — a data-mutating PUT | Unit like nodes.test.ts | S–M | **YES** |
| 6 | Node browser: `$branch.tsx` (1,137) + `node-detail-panel.tsx` (1,244) | Two largest files, zero tests, all destructive node ops (rename/move/push/delete incl. allBranches) with dialog validation | Component via `renderRoute`: smoke + rename-validation + delete-confirm flows asserting `apiFetch` calls | L | **YES** (at least destructive flows) |
| 7 | `routes/exports.tsx` (970) + dumps write paths | Create/import dialog validation, upload, task wiring; dumps test covers read path only | Component: create-dialog validation + submit → mutation call | M–L | should |
| 8 | `assets/js/lib/hooks/use-websocket.ts` | Singleton refcounting — last-unmount-closes is easy to break | `renderHook` with two consumers | S | should |
| 9 | `apis/events/events.ts` | `parseMessage` guards, `webSocketEvent` dispatch, listener idempotence | Unit with mocked `/lib/xp/event` + `/lib/xp/websocket` | S | should |
| 10 | `routes/search.tsx` (549) | NoQL wiring: validation error + suggestion rendering, repo/branch selection, pagination (the lib is tested; the wiring isn't) | Component: invalid query → error; valid → search call | M | should |
| 11 | `routes/tasks.tsx`, `audit.tsx`, `events.tsx` | List/filter pages; audit has 5 filter states | Smoke component tests | S each | nice |
| 12 | `apis/audit.ts`, `apis/system.ts` | `parseIntParam` fallbacks; bean passthrough | Tiny unit / skip system | S | nice |
| 13 | `components/ui/*`, theme, status-bar | Presentational Radix wrappers | Skip | — | no |

**Infra to fix alongside:** stub `window.scrollTo` in `setup-dom.ts`; add
`src/test/**` to a type-checked tsconfig (`tsconfig.test.json` + `check:types`); add
`@vitest/coverage-v8` + `coverage` config; consider migrating route tests from
module-mocking `apiFetch` to fetch-level mocks (MSW or `vi.stubGlobal`) returning
real `{data}` envelopes — that single change makes gap #1 partially covered by every
existing route test.

## Overall assessment

Better than typical for its size: server handler coverage is honest behavior testing
rather than mock theater, and the noql/export/management-api/jwt tests are genuinely
strong refactor protection. The structural weakness is the client: the four most
complex client assets — API client, WebSocket state machine, task-progress reducer,
and the ~2.4k-LOC node browser — have zero tests, while existing route tests cover
only read-path rendering and mock away the one module (`apiFetch`) whose contract a
refactor is most likely to break. Fill gaps 1–6 and fix the type-check hole before
refactoring; the rest can trail the refactor.
