# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**data-kit** (`com.enonic.app.datakit`) is an Enonic XP admin tool for data management. It has no site components — only `admin/tools/main/`.

## Commands

```bash
# Build + deploy to sandbox (watch mode)
./gradlew deploy -t -Penv=dev

# Full build (production by default)
./gradlew build

# Explicit dev build
./gradlew build -Penv=dev

# Vite only (faster during development)
pnpm build          # dev build
pnpm build:prod     # production build
pnpm check          # lint + type-check + tests
pnpm test           # vitest only
pnpm fix            # auto-fix lint issues (Biome)
```

> Gradle wrapper (`gradlew`) must be present. If missing, run `gradle wrapper --gradle-version 8.7` or copy from another Enonic project.

## Architecture

**Build pipeline:** Two parallel build pipelines compile TypeScript sources into `build/resources/main/`:

- **Client-side (Vite):** `src/main/resources/assets/` → `build/resources/main/assets/`
  - Two build targets controlled by `BUILD_TARGET` env var:
    - `js` — bundles `assets/js/app.tsx` → `assets/js/bundle.js` (React, ES2023, ESM format)
    - `css` — processes `assets/styles/main.css` through Tailwind 4 (via Vite plugin) → `assets/styles/main.css`
- **Server-side (esbuild):** `src/main/resources/**/*.ts` (excluding `assets/`) → `build/resources/main/`
  - Compiles to CJS ES2015 (what XP's GraalJS engine expects)
  - Auto-discovers all `.ts` entry points — future controllers/services work without config changes
  - XP library imports (`/lib/xp/*`, `/lib/mustache`) are externalized (resolved at runtime by XP)
  - Uses `@enonic-types/*@^7.16.x` for type-checking (XP 8 types not yet published; API is compatible)
- **pnpmBuild Gradle task** calls `pnpm run build:dev` (or `build:prod` with `-Penv=prod`), which runs Vite and esbuild in parallel
- **processResources** excludes `assets/js/**`, `assets/styles/**`, `**/*.ts`, `**/*.tsx`, and `**/tsconfig.json`

**Admin tool entry:**
- `admin/tools/main/main.yml` — tool descriptor (YAML, i18n object format). `main.ts` renders `main.html` (Mustache) with asset URLs. The JS bundle (`assets/js/bundle.js`) is a React app.
- The bundle reads `data-admin-url` and `data-tool-url` from `document.currentScript`.
- Descriptor uses `admin:extension` API (XP 8 admin framework), not the old `admin:widget`.
- `i18n/phrases.properties` — localization strings for the tool descriptor.

**Linting & testing:**
- **Biome** is the sole linter (no ESLint). Covers both client and server TS/TSX/CSS. Config in `biome.json`.
- **Vitest** for unit tests. Test files in `src/test/**/*.test.ts`. Config in `vitest.config.ts`.
- **Husky** pre-commit hook runs `biome check --staged`.

**Key files:**
- `gradle.properties` — app key (`com.enonic.app.datakit`), XP version
- `build.gradle` — Gradle + Node/pnpm plugin, `pnpmBuild` / `pnpmCheck` wiring, env detection
- `biome.json` — Biome linter config (import sorting, Tailwind class sorting, strict rules)
- `vitest.config.ts` — Vitest test runner config
- `vite.config.ts` — dual-target (`js`/`css`) Vite config for client-side assets
- `esbuild.server.js` — server-side TS build script (CJS output for XP)
- `tsconfig.json` — client-side TypeScript config (`src/main/resources/assets/**/*.ts`, browser target)
- `src/main/resources/tsconfig.json` — server-side TypeScript config (XP globals, CommonJS)

## Adding XP Libraries

1. Add to `build.gradle` dependencies: `include "com.enonic.xp:lib-auth:${xpVersion}"`
2. Add types: `pnpm add -D @enonic-types/lib-auth`
3. Add `/lib/mustache`-style libs to `external` in `esbuild.server.js` if not covered by `/lib/xp/*` wildcard

## Git & GitHub

Conventional commit format throughout. Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`, `ci`.

### Issues

- **Title**: `<type>: <description>` — e.g. `feat: add export dialog`
- **Body**:

  ```
  <4–8 sentence description: what, what's affected, how to reproduce, impact>

  ##### Rationale
  <why this needs to be fixed or implemented>

  ##### References        ← optional
  ##### Implementation Notes  ← optional

  <sub>*Drafted with AI assistance*</sub>
  ```

### Commits

- **With issue**: `<Issue Title> #<number>` — e.g. `feat: add export dialog #12`
- **Without issue**: `<type>: <description>`
- **Body** (optional): past tense, one line per change, 2–6 lines, backticks for code refs

### Pull Requests

- **Title**: `<Issue Title> #<number>`
- **Body**:

  ```
  ## Changes
  - <change 1>
  - <change 2>

  Closes #<number>

  <sub>*Drafted with AI assistance*</sub>
  ```

- No emojis. Factual, no verbose explanations.
