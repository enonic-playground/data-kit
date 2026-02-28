# CLAUDE.md

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

## Architecture

**Build pipeline:** Two parallel pipelines compile TypeScript into `build/resources/main/`:

- **Client-side (Vite):** `src/main/resources/assets/` — React app (`js` target) and Tailwind 4 CSS (`css` target), controlled by `BUILD_TARGET` env var
- **Server-side (esbuild):** `src/main/resources/**/*.ts` (excluding `assets/`, `lib/`, `types/`) — CJS ES2015 for XP's Nashorn engine. Auto-discovers `.ts` entry points. XP imports (`/lib/xp/*`, `/lib/mustache`) are externalized.
- Uses `@enonic-types/*@^7.16.x` for type-checking (XP 8 types not yet published; API is compatible)

**Admin tool entry:**
- `admin/tools/main/main.ts` renders `main.html` (Mustache) with asset URLs. The JS bundle (`assets/js/bundle.js`) is a React app.
- Descriptor uses `admin:extension` API (XP 8 admin framework), not the old `admin:widget`.

## XP 8 Descriptors

XP 8 replaced XML descriptors with YAML across the board. All descriptors in this project use `.yml` — **never create `.xml` descriptors**. This applies to:

- API descriptors (`apis/*/*.yml`)
- Admin tool descriptors (`admin/tools/main/main.yml`)
- Content types, mixins, x-data, etc.

There is little official documentation on this yet, so don't rely on older XP docs that show XML examples.

## Adding XP Libraries

1. Add to `build.gradle` dependencies: `include "com.enonic.xp:lib-auth:${xpVersion}"`
2. Add types: `pnpm add -D @enonic-types/lib-auth`
3. Add `/lib/mustache`-style libs to `external` in `esbuild.server.js` if not covered by `/lib/xp/*` wildcard

## Git & GitHub

Conventional commit format throughout. Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`, `ci`.

**`gh` CLI:** Do not assume the `gh` tool is available. If it is missing, the environment is likely a sandbox — do not attempt to install or download it. Use raw `git` commands instead.

### Issue Labels

Each issue gets one **main** label + 0–2 **supportive** labels.

- **Main** (exactly one): `bug`, `feature`, `improvement`, `epic` — or others inferred from context
- **Supportive** (optional):
  - `UI/UX` — changes primarily affecting frontend visuals/interactions (not logic-only or API)
  - `DX` — build, tooling, or developer experience improvements
  - `AI` — code assistant related
  - `wontfix` — closing without changes

### Issues

- **Title**: `<type>: <description>` — e.g. `feat: add export dialog`
- **Body**: concisely explain what and why, skip trivial details
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

- **Title**: `<type>: <description> #<number>` — use the primary change type (commit format)
- **Body**: concisely explain what and why, skip trivial details. No emojis. Separate all sections with one blank line.
  ```
  <summary of changes>

  Closes #<number>

  [Claude Code session](<link>)

  <sub>*Drafted with AI assistance*</sub>
  ```
