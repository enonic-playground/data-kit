# Build, Tooling & CI

Gradle (Kotlin + XP packaging) orchestrating two JS pipelines: Vite/vite-plus for
client assets (js/css targets via `BUILD_TARGET`), esbuild for server TS. CI
(`gradle.yml`) does run the full quality gate transitively — `gradlew build` →
`check` → `pnpmCheck` → `vp lint && tsgo && vp test`. The setup is deliberately
engineered and modern; the problems are operational (stale artifacts, committed dead
files) and strategic (vite-plus 0.1.x + tsgo nightly + three beta XP libs all on the
critical path).

## High

### BLD-1 — Stale build outputs can ship inside the jar
`build.gradle.kts:70-81`, `vite.config.ts:39,62`, `esbuild.server.js:24`

Nothing ever cleans `build/resources/main` between pnpm builds: Vite runs with
`emptyOutDir: false` (both targets), esbuild has no prune, and `pnpmBuild` always
reruns (`outputs.upToDateWhen { false }`) but only overwrites. Confirmed live: a dev
sourcemap (`main.js.map`) currently sits in the output dir — a `./gradlew build`
(prod) without `clean` would package it, plus orphan hashed chunks accumulated
during `deploy -t` watch sessions. CI is safe (clean checkout); local release builds
are not.
**Fix:** prune before `pnpmBuild` (Gradle `Delete` dependency), or build into an
intermediate dir and `Sync` (see P1).

### BLD-2 — Dead compiled artifacts committed at repo root `admin/` ✔ verified
`admin/tools/admin/admin.js`, `admin/tools/main/main.js` (confirmed via `git ls-files`)

Two esbuild CJS outputs tracked in git at the repo root (outside `src/`) — leftovers
from an earlier esbuild `outbase` misconfiguration. `admin/tools/admin/admin.js` has
no corresponding source anymore. The lint config masks them
(`ignorePatterns: ['admin/']`, `vite.config.ts:114`) — the ignore entry exists to
hide the corpse.
**Fix:** delete the directory, drop the ignore pattern, guard via `.gitignore`.

### BLD-3 — Pre-commit and `check` never verify formatting
`vite.config.ts:169-171`, `package.json:19`

The staged hook runs only `vp lint --fix`; `vp fmt` exists in `fix` but is absent
from both `staged` and `check`. After the one-shot `style: apply Oxlint formatter`
commit (8a95ec0), nothing prevents drift — CI green-lights unformatted code; the
import-sort/tailwind-sort config is decorative.
**Fix:** add `vp fmt` to the staged map (or `vp fmt --check` to `check`).

## Medium

### BLD-4 — Overlapping Gradle task outputs, no ordering constraint
`build.gradle.kts:79,97` — `pnpmBuild` declares `outputs.dir("build/resources/main")`,
the same directory `processResources` owns. Overlapping outputs disable build-cache
for both tasks and risk stale-output deletion; no `mustRunAfter` between them — a
real race once configuration-cache parallel execution is enabled.
**Fix:** narrow `pnpmBuild` outputs or build to an intermediate dir (P1).

### BLD-5 — Tests and build configs are type-check blind spots
`tsconfig.json:16`, `src/main/resources/tsconfig.json:20-21` — `src/test/**` (25 test
files), `vite.config.ts`, and `esbuild.server.js` are in no tsconfig; Vitest
transpiles without checking. Proven consequence: `buildConfig` drift
([05-tests.md, TST-INF-1](05-tests.md#notable-findings)).
**Fix:** `tsconfig.test.json` (jsdom + node libs) appended to `check:types`.

### BLD-6 — Contradictory pnpm build-permission config
`pnpm-workspace.yaml:1-2,9-11,19-20` — `esbuild` appears in `onlyBuiltDependencies`,
`ignoredBuiltDependencies`, and `allowBuilds: esbuild: false` simultaneously. The
intent (block esbuild's postinstall, rely on platform optional deps) works, but three
conflicting keys is config rot. **Fix:** keep exactly one mechanism
(`ignoredBuiltDependencies` is conventional).

### BLD-7 — Type gate runs on a nightly compiler, with the supply-chain buffer disabled for it
`package.json:50,56`, `pnpm-workspace.yaml:15-16` — `tsgo` pinned to
`7.0.0-dev.20260519.1` (exact — good) but `@typescript/native-preview*` is excluded
from `minimumReleaseAge`, removing the 3-day buffer for the one package executing on
every check. `typescript: ^6.0.3` is the lone caret range in a tilde-convention repo.
**Fix:** tilde-pin `typescript`; consider a periodic stable-`tsc` cross-check.

### BLD-8 — CI: push-only trigger, no fork coverage, no Node/pnpm caching
`.github/workflows/gradle.yml:3,16-19` — `on: [push]` means PRs from forks get zero
CI. `setup-gradle@v5` caches `~/.gradle` only — node-gradle re-downloads Node
24.13.1 and pnpm refetches the store every run. No `permissions:` block, no
`cancel-in-progress`, no jar artifact upload, no release workflow at all.
**Fix:** add `pull_request` trigger, `permissions: contents: read`, cache
`.gradle/nodejs` + pnpm store, `cancel-in-progress: true` (see P2).

### BLD-9 — esbuild entry auto-discovery is silently greedy and silently lossy
`esbuild.server.js:9-12` — every stray `.ts` next to a controller becomes its own
bundled entry shipped in the jar; conversely the substring filters
(`f.includes('/lib/')`, `'/types/'`) drop any nested directory named `lib` or
`types` anywhere, with no warning. Since `lib/*.ts` is inlined into each of ~17
entries, server lib modules are duplicated per bundle and **module-level state is
not shared across endpoints** (none exists today — verified for
`management-api.ts`/`jwt.ts` — but it's a latent trap, and KT-5's fix of holding a
bean at module scope must account for it).
**Fix:** anchor exclusions to path prefixes, log the discovered entry list, document
the no-shared-module-state constraint in CLAUDE.md (P4).

### BLD-10 — Lint coverage regressed vs the old Biome setup
`vite.config.ts:104` — plugins are `oxc, typescript, react, unicorn`: no `jsx-a11y`
(this is an admin UI with the a11y gaps found in [04](04-frontend-quality.md#fq-2)),
no `import` plugin (cycle detection), no `promise`, no `vitest` plugin for test
files, no `no-console`. **Fix:** enable `jsx-a11y` and `import` at minimum.

### BLD-11 — README documents nothing about building or developing
`README.md` covers only Management API auth. Build commands, sandbox deploy,
Node/pnpm requirements live solely in CLAUDE.md — fine for agents, useless for a
human cloning the repo. **Fix:** short Development section mirroring CLAUDE.md.

## Low

- **BLD-12** — `.gitignore` gaps: `.tanstack/`, `.kotlin/`, `.playwright-mcp/`,
  `.tmp/`, `.idea/` (currently invisible only because of the local global gitignore).
  `.vite-hooks/_` works but is cryptic.
- **BLD-13** — No wrapper checksum: `gradle-wrapper.properties` lacks
  `distributionSha256Sum` for Gradle 9.5.1.
- **BLD-14** — `mavenLocal()` first (`build.gradle.kts:46`): locally installed
  snapshots silently shadow mavenCentral/enonicRepo. Move last or guard behind a
  property.
- **BLD-15** — Engines not enforced: no `engine-strict=true` in `.npmrc`;
  `>=24.13.1` accepts any future major. Gradle pins Node exactly; local CLI runs
  don't.
- **BLD-16** — CLAUDE.md drift: claims `@enonic-types/*@8.0.0-A2` (actual 8.0.1,
  correctly matching `xpVersion=8.0.1`); omits `/lib/http-client` from the
  documented esbuild externals.
- **BLD-17** — `passWithNoTests: true` (`vite.config.ts:177`): a broken include glob
  silently passes `check` with zero tests executed.
- **BLD-18** — No `.editorconfig`: Kotlin/YAML/Gradle files have no editor-agnostic
  indent/EOL contract.
- **BLD-19** — Beta dependencies in the production path: `enonic-xp-app 4.0.0-B1`,
  `lib-http-client 4.0.0-B1`, `lib-mustache 3.0.0-B1`. Expected at this XP 8 stage;
  track for GA bumps. Move the inline-versioned deps (incl. `java-jwt:4.5.2`) into
  the version catalog.

## Info (positives worth keeping)

- All spot-checked descriptors (`application.yaml`, `main.yaml`, `export.yaml`, all
  `apis/*/*.yaml`) correctly declare `kind:` — XP 8 compliant throughout.
- Clean client/server tsconfig separation: server `lib: ["ES2023"]` (no DOM leak);
  `/lib/xp/*` path mapping mirrors esbuild externals exactly; Gradle `include()`
  libs and `@enonic-types/*` packages in 1:1 parity at 8.0.1.
- Real supply-chain posture: `minimumReleaseAge: 4320`, `strict-peer-deps`,
  `--frozen-lockfile` in CI, tilde save-prefix, exact Node/pnpm pins in Gradle.
- CI genuinely enforces lint+types+tests via the Gradle `check` wiring.
- The whole lint/fmt/test/build chain rides on vite-plus `0.1.x` (catalog-pinned) —
  coherent but experimental; budget for churn.

## Restructuring proposals

- **P1 — Intermediate bundle directory (M).** Point Vite/esbuild at
  `build/bundles/`, add a Gradle `Sync` task into `build/resources/main`. Kills
  BLD-1 (Sync deletes stale files by definition) and BLD-4 (no overlapping outputs;
  both tasks become cacheable), and makes `pnpmBuild` honestly incremental.
- **P2 — Split CI into two jobs (S).** A pnpm-native job (`actions/setup-node` +
  pnpm cache → `pnpm check`) for fast PR feedback, plus the Gradle packaging job.
  Add `pull_request` trigger, `permissions`, jar artifact upload, and a tag-driven
  release workflow (the `dev:gradle-release` flow expects one — none exists).
- **P3 — Proper dev loop instead of `gradlew deploy -t` (M).** Continuous mode
  re-runs pnpmInstall + both Vite targets + esbuild on every change. Run
  `vite build --watch` + `esbuild --watch` writing into the sandbox-deployed
  exploded dir (or `build/resources/main` with a one-time deploy). Order-of-magnitude
  faster iteration; Gradle stays for packaging.
- **P4 — Explicit server entry manifest (S).** Replace `readdirSync` auto-discovery
  with a glob anchored to known controller locations (`apis/*/*.ts`, `admin/**/*.ts`,
  `main.ts`) plus a printed entry list — eliminates both halves of BLD-9.
- **P5 — Shared API contract types (M).** = SRV-R3 / FA-P1: a `types/shared/` dir
  included by both tsconfigs (types-only, so neither pipeline bundles runtime code)
  closes the dual-pipeline drift gap structurally.

## Overall assessment

A deliberately engineered, modern setup — the descriptor migration is complete, the
tsconfig split actually prevents DOM/server type bleed, CI transitively enforces the
full quality gate, and the pnpm supply-chain settings beat most production repos.
The two real problems are operational: stale artifacts in `build/resources/main` can
contaminate locally-built jars (a dev sourcemap is sitting there right now), and a
pair of dead compiled files is committed at the repo root and deliberately hidden
from lint. The strategic exposure is toolchain maturity — vite-plus 0.1.x, a tsgo
nightly as the only type gate, and three beta XP libs all on the critical path; a
defensible bet for an XP 8-era app, but it deserves the mitigations above so that
when the bleeding edge bleeds, it's contained.
