# Kotlin Backend

Five beans (`DumpManager`, `ExportManager`, `JwtGenerator`, `Support`,
`SystemInfoProvider`, 724 LOC) consumed from server TS via `__.newBean`. Overall:
small, readable, mostly follows `.claude/rules/kotlin.md`. The weaknesses cluster in
**filesystem safety** and **unbounded memory use**.

## Critical

### KT-1 — `delete(".")` wipes the entire dump/export directory ✔ verified — **FIXED 2026-06-10**
`DumpManager.kt:41-64`, `ExportManager.kt:43-49`, `apis/dumps/dumps.ts:135-141`, `apis/exports/exports.ts:146-152`

> **Status:** fixed. `Support.kt` now provides `Path.resolveChildEntry(name)`
> (direct-child + exact-filename check), used by all name-taking operations in both
> managers; the TS handlers enforce `VALID_NAME_PATTERN` on delete/download/load/
> upgrade/create as well (7 new handler tests). `.claude/rules/kotlin.md` and the
> canonical rule in the skills repo were updated to mandate the new pattern (KT-14
> also resolved). KT-2 (heap zip), KT-3 (symlink follow), and KT-7 (TOCTOU) remain
> open.

`dumpDir.resolve(".").normalize()` (or any name normalizing to the base, e.g.
`foo/..`) equals `dumpDir` itself; `startsWith(dumpDir)` is true for the base path
(a path starts with itself), `Files.isDirectory` is true, and `deleteRecursively()`
deletes **every dump/export on the server** in one request. The API delete/download
handlers never apply `VALID_NAME_PATTERN` (only enforced on upload — verified:
`dumps.ts:72` is the only call site), so `DELETE /apis/dumps?name=.` goes straight
through. Multi-segment names (`mydump/versions`) also pass and let callers delete
files *inside* an entry, silently corrupting it while returning `true`.
`ExportManager.download` has no validity check at all, so `name="."` zips the whole
export root (see KT-2).

**Fix:** in the beans, require a single path segment —
`target != baseDir && target.parent == baseDir` (or reject names containing `/`,
`\`, `..`) — and additionally enforce `VALID_NAME_PATTERN` in the delete/download API
handlers. Extract one shared `resolveEntry(baseDir, name)` helper used by all file
operations in both managers.

## High

### KT-2 — Entire dump zipped into heap memory on download
`Support.kt:54-71` (`zipToByteSource`), used at `DumpManager.kt:81`, `ExportManager.kt:100`

The whole directory is compressed into a `ByteArrayOutputStream`. XP dumps are
routinely multiple GB; one download of an unarchived dump can OOM the entire XP node
(DoS by a single admin click).
**Fix:** stream to a temp file (`Files.createTempFile` +
`GuavaFiles.asByteSource(tempFile)`) or pre-archive server-side; never buffer
archives in heap.

### KT-3 — `deleteRecursively` follows directory symlinks
`Support.kt:35-45`

`Files.isDirectory(this)` and `newDirectoryStream` both follow symlinks, so a symlink
inside the dump/export dir pointing elsewhere causes deletion of the **target's**
contents outside the base directory. The lexical `startsWith` check in callers cannot
catch this.
**Fix:** `Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)` (delete the link itself,
never recurse through it), or `Files.walkFileTree` / stdlib `@ExperimentalPathApi
Path.deleteRecursively()`, which handle links correctly.

## Medium

### KT-4 — `DirectoryIteratorException`/`UncheckedIOException` escape all `IOException` handlers
`Support.kt:15-23,37-41`, `DumpManager.kt:28-36`, `ExportManager.kt:27-35`

Errors during `DirectoryStream` iteration are thrown as `DirectoryIteratorException`
(a `RuntimeException`), and `Files.walk` throws `UncheckedIOException` — neither is
caught by `catch (e: IOException)` in `list()`, `directorySizeSafe()`, or around
`deleteRecursively`. One unreadable entry crashes the whole listing with a raw,
untyped error crossing the JS boundary.
**Fix:** also catch `DirectoryIteratorException`/`UncheckedIOException` (unwrap
`.cause`) wherever `IOException` is handled.

### KT-5 — JwtGenerator key cache is dead code — bean created per call ✔ verified
`JwtGenerator.kt:18-19,75-104`, `lib/jwt.ts:57`

`generateBearerToken` calls `__.newBean(...)` inside the function, so every
management-API request gets a fresh `JwtGenerator` with an empty cache — the
`@Volatile`/`@Synchronized` machinery never engages, and the RSA key file is read and
parsed on every token. (Contrast `lib/dumps.ts:39` / `lib/exports.ts:43`, which
correctly hold the bean at module scope.) Conversely, if the bean *were* cached, the
cache has no mtime invalidation, so key rotation at the same path would be ignored.
**Fix:** move `newBean` to module scope in `jwt.ts`; add file-mtime checking (or a
short TTL) to the key cache.

### KT-6 — JSON unescape corrupts keys containing `\r`/`\t`/`\uXXXX` escapes
`JwtGenerator.kt:107-117`

`unescapeJsonString` handles only `\n`, `\"`, `\\`; `\r` becomes the literal letter
`r`, `\t` becomes `t`, `\uXXXX` becomes `uXXXX`. A key file generated with CRLF line
endings injects `r` characters into the PEM body, which survive the whitespace filter
and corrupt the Base64 — key load fails with an opaque error.
**Fix:** handle the full JSON escape set (`\r`, `\t`, `\/`, `\b`, `\f`, `\uXXXX`).

### KT-7 — Upload TOCTOU with a shared, fixed temp filename
`DumpManager.kt:94-108`, `ExportManager.kt:113-127`

The exists-check and `Files.move` are not atomic, and concurrent uploads of the same
name share the literal temp path `.$name.zip.tmp`: the second `Files.copy` throws
`FileAlreadyExistsException` (→ 500 instead of a clean 409), and one request's
`finally { deleteIfExists(tempFile) }` can delete the temp file another request is
still writing.
**Fix:** `Files.createTempFile(dir, ...)` for a unique temp name; catch
`FileAlreadyExistsException` from `Files.move` and return `false` (409).

### KT-8 — `upload` parameter contract: `InputStream?` in Kotlin vs ByteSource from TS
`DumpManager.kt:87`, `ExportManager.kt:106`, `types/DumpManager.d.ts:5`, `lib/dumps.ts:59`

The `.d.ts` declares `data: object` and callers pass the Guava `ByteSource` from
`getMultipartStream` (cast `as object`), while the Kotlin method expects
`InputStream`. This works only because XP's GraalJS host-access layer maps
`ByteSource → InputStream`; the contract is invisible and fragile.
**Fix:** accept `ByteSource?` in Kotlin (already imported for `download`) and
`openStream().use { ... }` internally; declare `data: ByteSource` in the `.d.ts` and
drop the `as object` cast.

## Low

### KT-9 — `@Component(immediate = true)` on plain script beans
`DumpManager.kt:19`, `ExportManager.kt:18`, `JwtGenerator.kt:16`, `SystemInfoProvider.kt:7`

`__.newBean` instantiates these via the app classloader; the SCR annotation registers
no service anyone consumes — it just creates orphan instances at bundle activation.
**Note:** `.claude/rules/kotlin.md` shows `@Component(immediate = true)` in its ✅
examples, so removing it is a *convention change*, not just a code fix — decide
deliberately and update the rule if removal is chosen. Verify deploy still works
(`newBean` does not need SCR).

### KT-10 — Server paths leak to the client in error messages
`DumpManager.kt:62,111`, `JwtGenerator.kt:31,45`, surfaced via `String(e)` at `apis/dumps/dumps.ts:47,79,147` (and exports equivalents)

Wrapped `RuntimeException` messages embed absolute filesystem paths and JDK exception
details, returned verbatim by the API. Admin-only audience softens this, but it's
unnecessary disclosure. **Fix:** log details server-side; return generic message +
code (see SRV error-policy findings — same fix).

### KT-11 — Zip entry names use platform separators
`Support.kt:61` — `relativize(path).toString()` yields backslash entries on Windows
(ZIP spec mandates `/`). **Fix:** `entryName.replace(File.separatorChar, '/')`.

### KT-12 — Unbounded recursion and decompression in metadata scans
`Support.kt:12-26` (`directorySize` follows symlinks → cycles cause infinite
recursion; deep trees risk stack overflow), `DumpManager.kt:172-185`
(`reader.readText()` inflates a zip-contained `dump.json` fully into heap on every
`list()`). **Fix:** `Files.walkFileTree` without link-follow; cap bytes read from zip
entries.

### KT-13 — PKCS#1 PEM fails with a cryptic error
`JwtGenerator.kt:86-93` — only `BEGIN PRIVATE KEY` (PKCS#8) headers are stripped; a
`BEGIN RSA PRIVATE KEY` file fails deep in Base64/KeyFactory with no hint, despite the
TS config error text telling users to supply "a PKCS8 PEM". **Fix:** detect the
PKCS#1 header and throw a clear "convert to PKCS#8" message.

### KT-14 — `.claude/rules/kotlin.md` codifies the insufficient path check
The rules file's "Derive child paths safely" section presents exactly the
`resolve(name).normalize()` + `startsWith(base)` idiom as the ✅ pattern — the same
idiom that misses base-dir equality, multi-segment names, and symlinks (KT-1, KT-3).
**Fix:** amend the rule example to include `target != baseDir` and single-segment
enforcement, so the bug doesn't get re-introduced by following the rules.

## Info

- **Nullability inconsistency across the bean surface** — `delete(name: String?)` vs
  `writeMetadata(name: String, ...)` (`ExportManager.kt:40,67`); the `.d.ts` files
  declare everything non-null. Pick one convention (non-null, per the migration rule).
- **download/delete asymmetry** — when both `name/` and `name.zip` exist, `download`
  serves the zip (`DumpManager.kt:76`) but `delete` removes the directory
  (`DumpManager.kt:49`); `ExportManager.delete` also leaves a same-name zip behind
  after deleting the dir.
- **JWT claims are minimal** — `JwtGenerator.kt:57-62`: no `iss`/`aud`; an audience
  claim would harden tokens against replay to other RS256 verifiers sharing the key.
  RS256 itself and `Algorithm.RSA256(null, privateKey)` for sign-only are correct.
- `SystemInfoProvider.kt:24` — inline `java.io.File` FQN; just import it. Otherwise
  clean; `Long → JS number` disk values are safely within 2^53.
- `build.gradle.kts:112` — eager `.get()` on `compileJava` inside `configureEach`;
  works, but prefer provider wiring. `include("com.auth0:java-jwt:4.5.2")` drags
  `jackson-databind` into the bundle — keep current for CVE hygiene.
- **Sidecar naming** — `"$name.$METADATA_FILE"` yields double-dot
  `name..datakit-export.json` (`ExportManager.kt:78,170`); consistent everywhere, but
  worth normalizing if the format ever becomes user-visible.

## Overall assessment

The Kotlin layer largely follows the project's own rules: compiled regexes, a single
JSON-escaping helper, `.use {}` on streams, boring JVM signatures at the JS boundary.
The real weaknesses are concentrated in filesystem safety — the lexical
`resolve().normalize().startsWith()` idiom is treated as sufficient but misses the
base-directory identity case (KT-1), multi-segment names, and symlinks — and the API
layer validates names only on the write path, so the beans are the last line of
defense and currently fail at it. Secondary themes: unbounded memory use (in-heap
zipping) and a misunderstanding of NIO's exception taxonomy. One focused refactor — a
shared `resolveEntry(baseDir, name)` helper with single-segment + no-follow semantics
used by all four file operations in both managers, plus a temp-file-backed
`zipToByteSource` — addresses every Critical/High finding without restructuring.
