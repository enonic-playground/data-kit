package com.enonic.app.datakit

import com.enonic.xp.home.HomeDir
import com.google.common.io.ByteSource
import com.google.common.io.Files as GuavaFiles
import org.osgi.service.component.annotations.Component
import org.osgi.service.component.annotations.Deactivate
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.charset.CodingErrorAction
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.BasicFileAttributes
import java.nio.file.attribute.FileTime
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Future
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicInteger
import java.util.regex.Pattern
import java.util.regex.PatternSyntaxException

private val LOG_NAME_REGEX = """[A-Za-z0-9][A-Za-z0-9._-]*\.log""".toRegex()
private val ROTATED_LOG_NAME_REGEX = """.+\.\d{4}-\d{2}-\d{2}\.\d+\.log""".toRegex()

private const val SCAN_BUFFER_SIZE = 1 shl 20
private const val MIN_READ_COUNT = 1
private const val MAX_READ_COUNT = 1000
private const val SEARCH_BLOCK_LINES = 2048
private const val SEARCH_BLOCK_BYTES = 4L shl 20
private const val MAX_READ_BYTES = 100L shl 20
private const val MATCH_BUDGET_MILLIS = 1000L
private const val SEARCH_BUDGET_MILLIS = 30_000L
private const val SEARCH_GRACE_MILLIS = 5_000L
private const val MATCH_SLICE_MILLIS = 750L
internal const val MAX_MATCH_SCANS = 4
private const val COUNT_THREADS = 2
private const val COUNT_THREADS_MAX = 6
private const val SEARCH_THREADS = 4
private const val SEARCH_THREADS_MAX = 20
private const val SEARCH_THREAD_IDLE_SECONDS = 30L
private const val DEADLINE_CHECK_INTERVAL = 4096
private const val MAX_REPETITION_PRODUCT = 1_000_000L
private const val BRACED_ESCAPES = "pPxN"

// ? Group 1 is the flags being switched on; anything after a `-` is being switched off.
private val INLINE_FLAGS_REGEX = """\(\?([a-zA-Z]*)(?:-[a-zA-Z]*)?[):]""".toRegex()
private const val MAX_CACHED_INDEXES = 4
private const val INITIAL_OFFSET_CAPACITY = 1024

// ? Level codes double as bit positions in the filter mask. `LEVEL_UNKNOWN` is a continuation
// ? with no entry above it to inherit from: the head of a file that starts mid stack trace.
internal const val LEVEL_UNKNOWN: Byte = 0
internal const val LEVEL_TRACE: Byte = 1
internal const val LEVEL_DEBUG: Byte = 2
internal const val LEVEL_INFO: Byte = 3
internal const val LEVEL_WARN: Byte = 4
internal const val LEVEL_ERROR: Byte = 5
internal const val LEVEL_COUNT = 6
internal const val LEVEL_MASK_ALL = 0b111110

// ! Must stay in step with `ENTRY_PREFIX` in `assets/js/components/log-viewer/log-line.ts`.
// ! The two decide what an entry is; if they disagree, the gutter numbers stop matching the
// ! colouring of the very lines they label.
private const val HEAD_CAPACITY = 512
private const val TIME_LENGTH = 12
private const val MAX_LOGGER_LENGTH = 256
private const val MIN_ENTRY_HEAD = 22

private val LEVEL_TOKENS = arrayOf(
    "TRACE".toByteArray(Charsets.US_ASCII),
    "DEBUG".toByteArray(Charsets.US_ASCII),
    "INFO".toByteArray(Charsets.US_ASCII),
    "WARN".toByteArray(Charsets.US_ASCII),
    "ERROR".toByteArray(Charsets.US_ASCII),
)

private val LEVEL_NAMES = arrayOf("unknown", "trace", "debug", "info", "warn", "error")

private const val SPACE = ' '.code.toByte()
private const val TAB = '\t'.code.toByte()
private const val DASH = '-'.code.toByte()
private const val COLON = ':'.code.toByte()
private const val DOT = '.'.code.toByte()
private const val ZERO = '0'.code.toByte()
private const val NINE = '9'.code.toByte()

// ? A physical line number and its separator, charged against the read budget so the `numbers`
// ? array of a filtered response cannot push it past the cap.
private const val NUMBER_COST = 12L

private const val NEWLINE = '\n'.code.toByte()
private const val CARRIAGE_RETURN = '\r'.code.toByte()

internal const val LOG_NOT_FOUND = -2L
internal const val LOG_NO_MATCH = -1L
internal const val LOG_SEARCH_ABORTED = -3L
internal const val LOG_SEARCH_STALE = -4L
internal const val LOG_SLICE_OK = 0L
internal const val LOG_SEARCH_BUSY = -5L

private const val CURSOR_STALE = -1
private const val CURSOR_BUSY = -2

private const val FOLD_OK = 0
private const val FOLD_SUPERSEDED = 1
private const val FOLD_STALE = 2

private const val ABORTED_JSON = """{"status":"aborted"}"""
private const val STALE_JSON = """{"status":"stale"}"""
private const val BUSY_JSON = """{"status":"busy"}"""

@Component(immediate = true)
class LogManager {
    /** Test seam: when set, replaces `$XP_HOME/logs` as the directory the bean reads. */
    internal var logsDirOverride: Path? = null

    /** Test seam: milliseconds a regex may spend on one line before the search aborts. */
    internal var matchBudgetMillis: Long = MATCH_BUDGET_MILLIS

    /** Test seam: milliseconds a whole search may run before it aborts. */
    internal var searchBudgetMillis: Long = SEARCH_BUDGET_MILLIS

    /** Test seam: milliseconds the caller waits past the search budget before abandoning. */
    internal var searchGraceMillis: Long = SEARCH_GRACE_MILLIS

    /** Test seam: milliseconds one match-counting slice may scan before it hands back. */
    internal var matchSliceMillis: Long = MATCH_SLICE_MILLIS

    /** Test seam: how far a pattern's repetition counts may multiply before it is refused. */
    internal var maxRepetitionProduct: Long = MAX_REPETITION_PRODUCT

    /** Test seam: bytes of line content a single read response may carry. */
    internal var maxReadBytes: Long = MAX_READ_BYTES

    // ? A search runs on its own thread so the caller can walk away from one that will not stop.
    private val searchPool = ScanPool("datakit-log-search", SEARCH_THREADS, SEARCH_THREADS_MAX)

    // ! Its own pool, and so its own stranded-thread accounting: slices in flight must not make
    // ! the next Enter fail, and crediting a stranded count to the search pool would leave
    // ! counting permanently short of the capacity it just lost.
    private val countPool = ScanPool("datakit-log-count", COUNT_THREADS, COUNT_THREADS_MAX)

    @Deactivate
    fun deactivate() {
        searchPool.shutdown()
        countPool.shutdown()
    }

    fun list(): String {
        val dir = logsDirectory()
        if (!Files.isDirectory(dir)) return "[]"

        val entries = mutableListOf<LogFileEntry>()

        try {
            Files.newDirectoryStream(dir).use { stream ->
                for (entry in stream) {
                    val name = entry.fileName.toString()
                    if (!LOG_NAME_REGEX.matches(name) || !Files.isRegularFile(entry)) continue
                    val attrs = readAttributes(entry) ?: continue
                    entries += LogFileEntry(name, attrs.size(), attrs.lastModifiedTime())
                }
            }
        } catch (e: IOException) {
            throw RuntimeException("Failed to list logs: ${e.message}", e)
        }

        entries.sortWith(compareByDescending<LogFileEntry> { it.modified }.thenBy { it.name })

        // ? `active` is the one file the tool opens by default; `rotated` per entry is a
        // ? different question — whether anything can still be appended to it. Only one entry is
        // ? ever active, so a second unrotated file (an `audit.log` beside `server.log`) must not
        // ? be reported as rotated just because it lost the tie.
        val active = entries.firstOrNull { !ROTATED_LOG_NAME_REGEX.matches(it.name) }
            ?: entries.firstOrNull()
        val ordered = if (active == null) entries else listOf(active) + entries.filter { it !== active }

        return ordered.joinToString(",", prefix = "[", postfix = "]") { entry ->
            buildString {
                append("{\"name\":")
                append(jsonString(entry.name))
                append(",\"size\":")
                append(entry.size)
                append(",\"modified\":")
                append(jsonString(entry.modified.toInstant().toString()))
                append(",\"active\":")
                append(entry === active)
                append(",\"rotated\":")
                append(entry !== active && ROTATED_LOG_NAME_REGEX.matches(entry.name))
                append('}')
            }
        }
    }

    /**
     * File metadata plus a per-level line count. When [mask] selects a strict subset of the
     * levels it also carries `filtered`, the number of lines that view holds.
     */
    fun info(name: String?, mask: Int): String? {
        val file = resolveLogFile(name) ?: return null
        return LogIndexCache.get(file).infoJson(file.fileName.toString(), mask)
    }

    /**
     * A page of lines. [from] and the reported total count physical lines when [mask] admits
     * every level, and positions in the filtered view otherwise — in which case the response
     * also carries the physical line number of each line it returns.
     */
    fun read(name: String?, from: Long, count: Int, mask: Int): String? {
        val file = resolveLogFile(name) ?: return null
        return LogIndexCache.get(file).readJson(from, count, maxReadBytes, mask)
    }

    /**
     * Where physical line [line] sits in the filtered view, as `{"position":P,"visible":B}`. A
     * line the filter hides reports the nearest visible position instead, so a search hit
     * outside the filter still puts the viewport somewhere sensible. `null` when the file name
     * is invalid or the file is missing.
     */
    fun locate(name: String?, mask: Int, line: Long): String? {
        val file = resolveLogFile(name) ?: return null
        return LogIndexCache.get(file).locateJson(mask, line)
    }

    /**
     * The next match in [forward]'s direction, with the whole file's match count around it:
     * `{"status":"ok","line":L,"ordinal":O,"total":T,"levels":[..],"scanned":S,"lines":N,
     * "complete":B}`. `line` and `ordinal` are `null` when nothing matches, and `ordinal` alone
     * is `null` when the count has not reached the hit yet. `null` for an invalid or missing
     * file; a `status` of `aborted` or `stale` when the scan could not finish or the file was
     * rewritten under it. Throws [IllegalArgumentException] for an empty query or an invalid
     * regular expression.
     *
     * A match is only ever a line [mask] admits, so the caller can always put the hit on screen.
     */
    fun search(
        name: String?,
        query: String?,
        from: Long,
        forward: Boolean,
        regex: Boolean,
        caseSensitive: Boolean,
        mask: Int,
    ): String? {
        val matcher = lineMatcher(query, regex, caseSensitive, matchBudgetMillis, maxRepetitionProduct)
        val key = matchKeyOf(query.orEmpty(), regex, caseSensitive)
        val file = resolveLogFile(name) ?: return null
        val index = LogIndexCache.get(file)

        // ? A complete match index answers from memory, so stepping through hits costs a binary
        // ? search rather than a scan of the file. That is what the count pays for.
        index.searchIndexed(key, mask, from, forward)?.let { return it }

        val line = guarded(searchPool, searchBudgetMillis, file) {
            index.search(matcher, mask, from, forward, searchBudgetMillis)
        }

        if (line == LOG_NOT_FOUND) return null
        if (line == LOG_SEARCH_STALE) return STALE_JSON
        if (line == LOG_SEARCH_BUSY) return BUSY_JSON
        if (line == LOG_SEARCH_ABORTED) return ABORTED_JSON
        return index.searchJson(key, mask, line)
    }

    /**
     * Extends the whole-file match index by one bounded slice and reports where it has got to,
     * as `{"status":"ok","total":T,"levels":[..],"scanned":S,"lines":N,"complete":B}`. The caller
     * re-calls while `complete` is false, so the request loop is the scheduler and the count
     * needs no background thread of its own.
     *
     * `null` for an invalid or missing file; a `status` of `aborted` or `stale` as [search].
     * Throws [IllegalArgumentException] for an empty query or an invalid regular expression.
     *
     * No level mask reaches this method: `levels` carries the per-level split of every match, so
     * the caller derives the visible and hidden counts from whichever filter is active without
     * the scan being thrown away when it changes.
     */
    fun matches(name: String?, query: String?, regex: Boolean, caseSensitive: Boolean): String? {
        val matcher = lineMatcher(query, regex, caseSensitive, matchBudgetMillis, maxRepetitionProduct)
        val key = matchKeyOf(query.orEmpty(), regex, caseSensitive)
        val file = resolveLogFile(name) ?: return null
        val index = LogIndexCache.get(file)

        val outcome = guarded(countPool, matchSliceMillis, file) {
            index.matchSlice(matcher, key, matchSliceMillis)
        }

        if (outcome == LOG_NOT_FOUND) return null
        if (outcome == LOG_SEARCH_STALE) return STALE_JSON
        if (outcome == LOG_SEARCH_BUSY) return BUSY_JSON
        if (outcome == LOG_SEARCH_ABORTED) return ABORTED_JSON
        return index.matchesJson(key)
    }

    /**
     * Runs [work] on [pool] under a watchdog set [budgetMillis] past its own deadline, or one of
     * the `LOG_SEARCH_*` codes when it could not be run, would not stop, or died on a pattern the
     * deadline check never reached.
     */
    private fun guarded(pool: ScanPool, budgetMillis: Long, file: Path, work: () -> Long): Long {
        val task = try {
            pool.submit(work)
        } catch (_: RejectedExecutionException) {
            // ! Distinct from a timeout: nothing ran, so nothing took too long. Reporting this as
            // ! an abort told the reader their pattern was too slow when the pool was merely full.
            return LOG_SEARCH_BUSY
        }

        return try {
            task.get(budgetMillis + searchGraceMillis, TimeUnit.MILLISECONDS)
        } catch (_: TimeoutException) {
            // ! Abandoned, not stopped: nothing can interrupt a match in progress. It costs only
            // ! its thread, which [ScanPool.strand] replaces to keep the live capacity.
            task.cancel(true)
            pool.strand()
            LOG_SEARCH_ABORTED
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            LOG_SEARCH_ABORTED
        } catch (e: ExecutionException) {
            when (val cause = e.cause) {
                // ! Some patterns exhaust the stack before the deadline check runs. Matching mutates
                // ! no index state, so the scan is simply over.
                is MatchTimeoutException, is StackOverflowError -> LOG_SEARCH_ABORTED
                null -> throw RuntimeException("Failed to scan log '${'$'}{file.fileName}'", e)
                else -> throw cause
            }
        }
    }

    fun download(name: String?): ByteSource? {
        val file = resolveLogFile(name) ?: return null
        return GuavaFiles.asByteSource(file.toFile())
    }

    private fun resolveLogFile(name: String?): Path? {
        if (name.isNullOrEmpty()) return null
        if (!LOG_NAME_REGEX.matches(name)) return null

        val target = logsDirectory().resolveChildEntry(name) ?: return null
        return if (Files.isRegularFile(target)) target else null
    }

    private fun logsDirectory(): Path =
        logsDirOverride ?: HomeDir.get().toFile().toPath().resolve("logs")
}

private class LogFileEntry(val name: String, val size: Long, val modified: FileTime)

/**
 * A pool of scan threads that replaces the ones it strands. Nothing can interrupt a match in
 * progress, so a scan that will not stop is abandoned rather than killed; growing the pool one
 * thread per abandonment keeps that from costing later scans their capacity, and [max] keeps a run
 * of them from exhausting the JVM.
 */
private class ScanPool(name: String, private val threads: Int, private val max: Int) {
    private val stranded = AtomicInteger()

    private val executor = ThreadPoolExecutor(
        0,
        threads,
        SEARCH_THREAD_IDLE_SECONDS,
        TimeUnit.SECONDS,
        SynchronousQueue(),
    ) { runnable -> Thread(runnable, name).apply { isDaemon = true } }

    fun submit(work: () -> Long): Future<Long> = executor.submit(Callable(work))

    fun strand() {
        executor.maximumPoolSize = poolCeiling(threads, stranded.incrementAndGet(), max)
    }

    fun shutdown() {
        executor.shutdownNow()
    }
}

/** What one search was started against: how far it may scan, and which build of the index. */
private class SearchScope(val total: Int, val generation: Int)

/**
 * One query's scan of one file: the physical lines it matched, and how far it has read. Sized by
 * matches found rather than by lines, so a query that hits nothing costs nothing to hold.
 */
private class MatchScan(val key: String) {
    var lines = IntArray(0)
    var count = 0
    var scanned = 0

    /** First index into [lines] at or after [line]. */
    fun lowerBound(line: Int): Int {
        var low = 0
        var high = count
        while (low < high) {
            val mid = (low + high) ushr 1
            if (lines[mid] < line) low = mid + 1 else high = mid
        }
        return low
    }
}

/**
 * Lines [start] until [end], copied out of the index so matching can run outside its monitor.
 * [levels] carries their level codes, copied with them because the array they come from is
 * reallocated under that monitor as the file grows.
 */
private class LineBlock(
    val start: Int,
    val end: Int,
    val lines: List<String>,
    val levels: ByteArray,
)

/**
 * Cache key of one query. The level mask is deliberately not part of it: matches are stored as
 * physical line numbers and `levels[]` already holds each line's level, so a mask is applied
 * when the index is read rather than when it is built. Toggling a level — which is exactly when
 * a reader is counting — then never throws a scan away.
 */
private fun matchKeyOf(query: String, regex: Boolean, caseSensitive: Boolean): String =
    "${if (regex) 'r' else 'p'}${if (caseSensitive) 's' else 'i'}\u0000$query"

private fun lineMatcher(
    query: String?,
    regex: Boolean,
    caseSensitive: Boolean,
    budgetMillis: Long,
    maxRepetition: Long,
): (String) -> Boolean {
    if (query.isNullOrEmpty()) throw IllegalArgumentException("query is required")

    if (!regex) {
        return { line -> line.contains(query, ignoreCase = !caseSensitive) }
    }

    val flags = if (caseSensitive) 0 else Pattern.CASE_INSENSITIVE or Pattern.UNICODE_CASE
    val pattern = try {
        Pattern.compile(query, flags)
    } catch (e: PatternSyntaxException) {
        throw IllegalArgumentException("Invalid regular expression: ${e.description}", e)
    }

    // ! Extended mode strips whitespace and honours `#` comments, so the same characters mean
    // ! different things to Java and to a scan of the raw text — which is a way to hide a runaway
    // ! rather than a formatting nicety worth having in a search box.
    if (enablesExtendedMode(query)) {
        throw IllegalArgumentException(
            "Invalid regular expression: extended mode (?x) is not supported in log search",
        )
    }

    // ! Refused rather than bounded: a pattern whose repetitions compound this far can spend that
    // ! many steps matching nothing, and a match consuming no input reaches no deadline.
    val cost = repetitionCost(query)
    if (cost > maxRepetition) {
        throw IllegalArgumentException(
            "Invalid regular expression: repetition can run to $cost steps, " +
                "above the limit of $maxRepetition",
        )
    }

    // ? Per line, not per search: a multi-gigabyte scan legitimately takes seconds, while no
    // ? single line needs a second unless the pattern is backtracking wildly.
    // ! Reached only through `get`, so a match consuming no character is bounded by neither this
    // ! nor the whole-search deadline. `repetitionCost` refuses the patterns that can do that; the
    // ! caller's watchdog is what catches whatever the scan does not.
    val budgetNanos = budgetMillis * 1_000_000L
    return { line -> pattern.matcher(DeadlineInput(line, System.nanoTime() + budgetNanos)).find() }
}

/**
 * Whether [query] switches on extended mode, under which Java ignores whitespace and treats `#` as
 * a comment — so a count can be split across a comment, or live text hidden inside one.
 *
 * Reading that faithfully would mean tracking flag scopes through the whole grammar. Refusing it
 * costs nothing real: `(?x)` exists to format regexes written in source files, not ones typed into
 * a search box.
 */
private fun enablesExtendedMode(query: String): Boolean =
    INLINE_FLAGS_REGEX.findAll(query).any { it.groupValues[1].contains('x') }

/**
 * A bound on the retries [query]'s counted repetitions can force, or [Long.MAX_VALUE] when the
 * pattern cannot be followed and has to be refused unread.
 *
 * Nesting multiplies and siblings add, which is what separates `(?:(?:){20000}){20000}` — four
 * hundred million retries of a group matching nothing — from an everyday
 * `.{0,1000}ERROR.{0,1000}at`, which is about three thousand. Bare `*` and `+` count as one: Java
 * halts those itself once an iteration matches empty, so only counted repetition compounds.
 *
 * ! Deliberately biased towards refusing, because it reads a grammar it does not own. Anything
 * ! leaving it out of step with Java — a class that never closes, a stray `)`, a `{` it cannot
 * ! place — returns the maximum rather than a guess. The watchdog in [LogManager.search] is what
 * ! stands behind it for whatever still slips past.
 */
internal fun repetitionCost(query: String): Long {
    val enclosing = ArrayDeque<Long>()
    var sum = 0L
    var index = 0

    while (index < query.length) {
        if (query[index] == '(') {
            enclosing.addLast(sum)
            sum = 0L
            index++
            continue
        }

        val atom: Long
        var next: Int

        if (query[index] == ')') {
            if (enclosing.isEmpty()) return Long.MAX_VALUE
            atom = maxOf(sum, 1L)
            sum = enclosing.removeLast()
            next = index + 1
        } else {
            atom = 1L
            next = when (query[index]) {
                '\\' -> escapeEnd(query, index)
                '[' -> characterClassEnd(query, index)
                else -> index + 1
            }
            if (next < 0) return Long.MAX_VALUE
        }

        var count = 1L
        if (next < query.length && query[next] == '{') {
            val close = query.indexOf('}', next + 1)
            val parsed = if (close < 0) null else repetitionCount(query.substring(next + 1, close))
            if (parsed != null) {
                count = parsed
                next = close + 1
            }
        }

        sum = saturatingPlus(sum, saturatingTimes(atom, count))
        index = next
    }

    return if (enclosing.isEmpty()) maxOf(sum, 1L) else Long.MAX_VALUE
}

/**
 * Index just past the escape starting at [index], or `-1` when it runs off the end.
 *
 * `\Q` quotes everything up to `\E`, and `\p{...}`, `\x{...}` and `\N{...}` carry braces that are
 * an argument rather than a quantifier. Reading either as a count is how a literal gets refused.
 */
private fun escapeEnd(query: String, index: Int): Int {
    val next = query.getOrNull(index + 1) ?: return -1

    if (next == 'Q') {
        val end = query.indexOf("\\E", index + 2)
        return if (end < 0) query.length else end + 2
    }

    if (next in BRACED_ESCAPES && query.getOrNull(index + 2) == '{') {
        val close = query.indexOf('}', index + 3)
        return if (close < 0) -1 else close + 1
    }

    return index + 2
}

/**
 * Index just past the `]` closing the class opened at [open], or `-1` when it never closes.
 *
 * A `]` sitting first in the body is a literal, and classes nest through `&&[...]`. Both are the
 * difference between reading the rest of the pattern and losing track of where a class ends.
 */
private fun characterClassEnd(query: String, open: Int): Int {
    var index = open + 1
    if (query.getOrNull(index) == '^') index++
    if (query.getOrNull(index) == ']') index++

    var depth = 1
    while (index < query.length) {
        when (query[index]) {
            '\\' -> index++
            '[' -> depth++
            ']' -> if (--depth == 0) return index + 1
        }
        index++
    }

    return -1
}

/**
 * Retries the quantifier between one pair of braces forces, or `null` when what sits between them
 * is not a count.
 *
 * `{n,}` costs `n` rather than nothing: an open-ended quantifier still owes its lower bound before
 * it may stop. A zero count floors at one, so a leading `a{0}` cannot zero the product and wave the
 * rest of the pattern through. Whitespace is dropped as a second line of defence: extended mode is
 * refused before this runs, and only extended mode lets a count contain any.
 */
private fun repetitionCount(body: String): Long? {
    val digits = body.filterNot { it.isWhitespace() }
    val comma = digits.indexOf(',')
    val head = if (comma < 0) digits else digits.substring(0, comma)
    val least = head.toLongOrNull() ?: return null
    if (comma < 0) return least.coerceAtLeast(1)

    val tail = digits.substring(comma + 1)
    if (tail.isEmpty()) return least.coerceAtLeast(1)
    return (tail.toLongOrNull() ?: return null).coerceAtLeast(1)
}

private fun saturatingTimes(a: Long, b: Long): Long =
    if (b != 0L && a > Long.MAX_VALUE / b) Long.MAX_VALUE else a * b

private fun saturatingPlus(a: Long, b: Long): Long =
    if (a > Long.MAX_VALUE - b) Long.MAX_VALUE else a + b

/** Control flow, not a fault: no message, no stack trace. */
private class MatchTimeoutException : RuntimeException(null, null, false, false)

/**
 * Regex input that abandons the match once [deadlineNanos] passes. `Matcher` reads the subject
 * through [get], so a pattern that backtracks catastrophically hits the check even though it
 * never returns control to the caller.
 */
private class DeadlineInput(
    private val line: CharSequence,
    private val deadlineNanos: Long,
) : CharSequence {
    private var countdown = DEADLINE_CHECK_INTERVAL

    override val length: Int
        get() = line.length

    override fun get(index: Int): Char {
        countdown--
        if (countdown <= 0) {
            countdown = DEADLINE_CHECK_INTERVAL
            // ? nanoTime has no fixed origin, so compare the difference, never the absolutes.
            if (System.nanoTime() - deadlineNanos >= 0) throw MatchTimeoutException()
        }
        return line[index]
    }

    override fun subSequence(startIndex: Int, endIndex: Int): CharSequence =
        DeadlineInput(line.subSequence(startIndex, endIndex), deadlineNanos)
}

private fun readAttributes(path: Path): BasicFileAttributes? =
    try {
        Files.readAttributes(path, BasicFileAttributes::class.java)
    } catch (_: IOException) {
        null
    }

private fun isDigit(byte: Byte): Boolean = byte >= ZERO && byte <= NINE

private fun isBlank(byte: Byte): Boolean = byte == SPACE || byte == TAB

/** `HH:mm:ss.SSS`, the fixed-width head of XP's Logback pattern. */
private fun hasTimePrefix(head: ByteArray): Boolean {
    if (!isDigit(head[0]) || !isDigit(head[1]) || head[2] != COLON) return false
    if (!isDigit(head[3]) || !isDigit(head[4]) || head[5] != COLON) return false
    if (!isDigit(head[6]) || !isDigit(head[7]) || head[8] != DOT) return false
    return isDigit(head[9]) && isDigit(head[10]) && isDigit(head[11])
}

/** Level code of the token at [at], or `0` when none of the five is there. */
private fun matchLevelToken(head: ByteArray, at: Int, length: Int): Int {
    for (index in LEVEL_TOKENS.indices) {
        val token = LEVEL_TOKENS[index]
        if (at + token.size > length) continue
        var i = 0
        while (i < token.size && head[at + i] == token[i]) i++
        if (i == token.size) return index + 1
    }
    return 0
}

/**
 * Level this line declares, or [LEVEL_UNKNOWN] when it is a continuation. Every part it reads
 * is ASCII in XP's pattern, so classification never decodes the line — which is what lets it
 * ride along with the offset scan instead of costing a pass of its own.
 */
private fun classifyHead(head: ByteArray, length: Int): Byte {
    if (length < MIN_ENTRY_HEAD) return LEVEL_UNKNOWN
    if (!hasTimePrefix(head) || head[TIME_LENGTH] != SPACE) return LEVEL_UNKNOWN

    val level = matchLevelToken(head, TIME_LENGTH + 1, length)
    if (level == 0) return LEVEL_UNKNOWN

    var i = TIME_LENGTH + 1 + LEVEL_TOKENS[level - 1].size
    if (i >= length || !isBlank(head[i])) return LEVEL_UNKNOWN
    while (i < length && isBlank(head[i])) i++

    val loggerStart = i
    while (i < length && !isBlank(head[i])) i++
    val loggerLength = i - loggerStart
    if (loggerLength == 0 || loggerLength > MAX_LOGGER_LENGTH) return LEVEL_UNKNOWN

    if (i + 2 >= length) return LEVEL_UNKNOWN
    val separated = head[i] == SPACE && head[i + 1] == DASH && head[i + 2] == SPACE
    return if (separated) level.toByte() else LEVEL_UNKNOWN
}

/**
 * Threads a pool of [base] may hold once [stranded] of its scans have been abandoned. One
 * replacement each, so a runaway never costs a later scan its capacity, up to [max].
 */
internal fun poolCeiling(base: Int, stranded: Int, max: Int): Int = minOf(base + stranded, max)

/**
 * Whether [mask] is a real filter. A mask admitting all five levels is the same view as no
 * filter at all, and taking the unfiltered path keeps [LEVEL_UNKNOWN] lines visible in it.
 */
internal fun isFiltering(mask: Int): Boolean =
    mask > 0 && (mask and LEVEL_MASK_ALL) != LEVEL_MASK_ALL

/**
 * Byte offset of the first character of every line in a log file.
 *
 * A line is any run of bytes terminated by `\n`; a trailing run without `\n` counts as a line too,
 * so an appended chunk simply continues it. The index is extended when the file grows and rebuilt
 * when it shrinks or changes identity (rotation).
 */
internal class LogLineIndex(private val path: Path) {
    private var offsets = LongArray(INITIAL_OFFSET_CAPACITY)
    private var levels = ByteArray(INITIAL_OFFSET_CAPACITY)
    private var lineCount = 0
    private var scannedBytes = 0L
    private var insideLine = false
    private var indexed = false
    private var fileKey: Any? = null
    private var lastModified: FileTime? = null

    // ? Bumped on every rebuild, so a search that left the monitor between blocks can tell that
    // ? the line numbers it is holding no longer describe this file.
    private var generation = 0

    // ? Head of the line being scanned. It outlives one `scan` call because a line can straddle
    // ? the read buffer, and one growth poll because the trailing line of a live file is still
    // ? being written to.
    private val head = ByteArray(HEAD_CAPACITY)
    private var headLength = 0
    private var levelCarry = LEVEL_UNKNOWN

    // ? Physical line numbers admitted by `maskCached`, extended as the file grows. One mask is
    // ? cached; switching rebuilds from `levels`, which is a pass over memory, not over the file.
    private var filtered = IntArray(0)
    private var filteredCount = 0
    private var filteredScanned = 0
    private var maskCached = -1

    // ? One scan per query, most-recent first — not the MRU-of-one `maskCached` uses, which is
    // ? safe only because `filteredIndex` rebuilds inside a single monitor hold.
    // ! A scan stops short of a line the file has not terminated. `filtered` has to show that
    // ! line; a match verdict on it is one the next byte can overturn, and leaving it out is
    // ! what makes every folded entry final.
    private val matchScans = ArrayDeque<MatchScan>()

    @Synchronized
    fun infoJson(name: String, mask: Int): String? {
        val attrs = refresh() ?: return null

        // ? Counted per call rather than kept incrementally: the trailing line is reclassified
        // ? as it grows, and undoing its old contribution costs more state than the pass costs.
        val counts = IntArray(LEVEL_COUNT)
        for (line in 0 until lineCount) counts[levels[line].toInt()]++

        return buildString {
            append("{\"name\":")
            append(jsonString(name))
            append(",\"size\":")
            append(attrs.size())
            append(",\"modified\":")
            append(jsonString(attrs.lastModifiedTime().toInstant().toString()))
            append(",\"lines\":")
            append(lineCount)
            append(",\"levels\":{")
            for (code in 0 until LEVEL_COUNT) {
                if (code > 0) append(',')
                append(jsonString(LEVEL_NAMES[code]))
                append(':')
                append(counts[code])
            }
            append('}')
            if (isFiltering(mask)) {
                filteredIndex(mask)
                append(",\"filtered\":")
                append(filteredCount)
            }
            append('}')
        }
    }

    @Synchronized
    fun locateJson(mask: Int, lineRequested: Long): String? {
        refresh() ?: return null

        val line = lineRequested.coerceAtLeast(0)

        if (!isFiltering(mask)) {
            val position = minOf(line, maxOf(0, lineCount - 1).toLong())
            return "{\"position\":$position,\"visible\":${lineCount > 0}}"
        }

        filteredIndex(mask)
        if (filteredCount == 0) return "{\"position\":0,\"visible\":false}"

        var low = 0
        var high = filteredCount
        while (low < high) {
            val mid = (low + high) ushr 1
            if (filtered[mid] < line) low = mid + 1 else high = mid
        }

        if (low < filteredCount && filtered[low].toLong() == line) {
            return "{\"position\":$low,\"visible\":true}"
        }

        // ? A hidden line is usually a stack frame of the entry above it, so fall back to that
        // ? entry rather than to the next visible line below.
        val nearest = if (low > 0) low - 1 else 0
        return "{\"position\":$nearest,\"visible\":false}"
    }

    @Synchronized
    fun readJson(fromRequested: Long, countRequested: Int, maxBytes: Long, mask: Int): String? {
        val attrs = refresh() ?: return null

        val from = fromRequested.coerceAtLeast(0)
        val count = countRequested.coerceIn(MIN_READ_COUNT, MAX_READ_COUNT)

        if (!isFiltering(mask)) {
            val fromLine = if (from >= lineCount) lineCount else from.toInt()
            val countedEnd = minOf(lineCount.toLong(), fromLine.toLong() + count).toInt()
            val lines = readLines(fromLine, budgetedEnd(fromLine, countedEnd, maxBytes))
            return linesJson(from, lines, null, lineCount, attrs.size(), maxBytes)
        }

        filteredIndex(mask)
        val start = if (from >= filteredCount) filteredCount else from.toInt()
        val end = minOf(filteredCount.toLong(), start.toLong() + count).toInt()
        val numbers = IntArray(end - start) { filtered[start + it] }
        val lines = readRuns(numbers, maxBytes)

        return linesJson(from, lines, numbers, filteredCount, attrs.size(), maxBytes)
    }

    /**
     * `numbers` is emitted only for a filtered read. An unfiltered response keeps the shape it
     * always had, where a line's physical number is [from] plus its position in the array.
     */
    private fun linesJson(
        from: Long,
        lines: List<String>,
        numbers: IntArray?,
        total: Int,
        size: Long,
        maxBytes: Long,
    ): String {
        // ? All three are pure ASCII, so their character count is their byte count.
        val head = "{\"from\":$from,\"lines\":["
        val middle = "],\"numbers\":["
        val tail = "],\"total\":$total,\"size\":$size}"

        // ! The raw budget bounds what was read, not what is sent: escaping and multi-byte
        // ! characters both expand on the wire. Trailing lines that miss out are dropped, and
        // ! the client resumes from `from` plus the array length as for any short page.
        val numberCost = if (numbers == null) 0L else NUMBER_COST
        val fixed = head.length + tail.length + if (numbers == null) 0 else middle.length

        var remaining = maxBytes - fixed

        var emitted = 0
        for (line in lines) {
            val cost = jsonStringBytes(line) + numberCost + if (emitted > 0) 1L else 0L
            if (cost > remaining) break
            remaining -= cost
            emitted++
        }

        return buildString {
            append(head)
            for (index in 0 until emitted) {
                if (index > 0) append(',')
                append(jsonString(lines[index]))
            }
            if (numbers != null) {
                append(middle)
                for (index in 0 until emitted) {
                    if (index > 0) append(',')
                    append(numbers[index])
                }
            }
            append(tail)
        }
    }

    /**
     * Lines at [numbers], read as contiguous runs. An entry and its stack frames are adjacent, so
     * a run usually covers a whole entry, and two hits far apart never pull the bytes between
     * them. Returns a prefix of what was asked for when the byte budget runs out.
     */
    private fun readRuns(numbers: IntArray, maxBytes: Long): List<String> {
        if (numbers.isEmpty()) return emptyList()

        val lines = ArrayList<String>(numbers.size)
        var budget = maxBytes
        var runStart = 0

        for (index in 1..numbers.size) {
            if (index < numbers.size && numbers[index] == numbers[index - 1] + 1) continue

            val first = numbers[runStart]
            val last = numbers[index - 1]
            val end = budgetedEnd(first, last + 1, budget)
            if (end <= first) return lines

            lines += readLines(first, end)
            budget -= lineEnd(end - 1) - offsets[first]
            if (end <= last) return lines

            runStart = index
        }

        return lines
    }

    /** Rebuilds [filtered] for [mask], or extends it over lines added since the last call. */
    private fun filteredIndex(mask: Int) {
        if (mask != maskCached) {
            maskCached = mask
            filteredCount = 0
            filteredScanned = 0
        } else if (filteredScanned > 0) {
            // ! The trailing line is reclassified every time the file grows, so the last line
            // ! folded in is the one that cannot be trusted — drop it and redo it.
            filteredScanned--
            while (filteredCount > 0 && filtered[filteredCount - 1] >= filteredScanned) {
                filteredCount--
            }
        }

        while (filteredScanned < lineCount) {
            if (mask and (1 shl levels[filteredScanned].toInt()) != 0) {
                if (filteredCount == filtered.size) {
                    val grown = if (filtered.isEmpty()) INITIAL_OFFSET_CAPACITY else filtered.size * 2
                    filtered = filtered.copyOf(grown)
                }
                filtered[filteredCount++] = filteredScanned
            }
            filteredScanned++
        }
    }

    /**
     * Line number of the first match at or after [fromRequested], in the direction [forward] gives,
     * among the lines [mask] admits. A line the filter hides is never offered to [matches].
     *
     * [LOG_NO_MATCH] means the whole requested range was scanned and held nothing. A range the scan
     * could not cover reports [LOG_SEARCH_STALE] instead — claiming absence from lines never read
     * would tell an admin the string is not in the log when nobody looked.
     *
     * Deliberately not `@Synchronized`: matching is the expensive part and needs nothing but a
     * `String`, so it runs between blocks rather than inside the monitor. Otherwise every read and
     * every follow poll on this file would queue behind it.
     */
    fun search(
        matches: (String) -> Boolean,
        mask: Int,
        fromRequested: Long,
        forward: Boolean,
        budgetMillis: Long,
    ): Long {
        val scope = searchScope() ?: return LOG_NOT_FOUND
        if (scope.total == 0) return LOG_NO_MATCH

        val from = fromRequested.coerceAtLeast(0)
        if (forward && from >= scope.total) return LOG_NO_MATCH

        val deadlineNanos = System.nanoTime() + budgetMillis * 1_000_000L
        var cursor = if (forward) from.toInt() else minOf(from, (scope.total - 1).toLong()).toInt()
        val filtering = isFiltering(mask)

        while (cursor in 0 until scope.total) {
            val block = searchBlock(cursor, forward, scope) ?: return LOG_SEARCH_STALE
            val order = if (forward) block.lines.indices else block.lines.indices.reversed()
            for (index in order) {
                if (System.nanoTime() - deadlineNanos >= 0) return LOG_SEARCH_ABORTED
                if (filtering && mask and (1 shl block.levels[index].toInt()) == 0) continue
                if (matches(block.lines[index])) {
                    // ! Matched outside the monitor against lines read a moment ago. Without this
                    // ! the number can point into a file that has since rotated away.
                    return if (stillCurrent(scope)) {
                        (block.start + index).toLong()
                    } else {
                        LOG_SEARCH_STALE
                    }
                }
            }
            cursor = if (forward) block.end else block.start - 1
        }
        return LOG_NO_MATCH
    }

    /**
     * Extends the scan for [key] by up to [sliceMillis] and stops. Returns [LOG_SLICE_OK] whether
     * or not it reached the end — [matchesJson] is what says which — [LOG_NOT_FOUND] when the file
     * is gone, [LOG_SEARCH_STALE] when it was rebuilt underneath, or [LOG_SEARCH_BUSY] when the
     * file is already counting as many queries at once as it will.
     *
     * Deliberately not `@Synchronized`, as [search]: blocks are copied out under the monitor and
     * matched outside it, so reads and follow polls never queue behind a count.
     */
    fun matchSlice(matches: (String) -> Boolean, key: String, sliceMillis: Long): Long {
        val scope = matchScope() ?: return LOG_NOT_FOUND
        val deadlineNanos = System.nanoTime() + sliceMillis * 1_000_000L

        while (true) {
            val cursor = matchCursor(scope, key)
            if (cursor == CURSOR_STALE) return LOG_SEARCH_STALE
            if (cursor == CURSOR_BUSY) return LOG_SEARCH_BUSY
            if (cursor >= scope.total) return LOG_SLICE_OK

            val block = searchBlock(cursor, true, scope) ?: return LOG_SEARCH_STALE
            val hits = IntArray(block.end - block.start)
            var found = 0
            for (index in block.lines.indices) {
                if (matches(block.lines[index])) hits[found++] = block.start + index
            }

            // ? A lost fold is contention, not staleness — the next turn picks up the cursor
            // ? the winner left. Only a rebuilt file invalidates the line numbers.
            if (foldMatches(scope, key, cursor, block.end, hits, found) == FOLD_STALE) {
                return LOG_SEARCH_STALE
            }

            // ! Checked after a block, never before one. A deadline shorter than a single block
            // ! would otherwise hand back having scanned nothing, and the caller's loop — which
            // ! re-calls until the scan is complete — would never end.
            if (System.nanoTime() - deadlineNanos >= 0) return LOG_SLICE_OK
        }
    }

    /** The extent one slice may cover, or `null` when the file is gone. */
    @Synchronized
    private fun matchScope(): SearchScope? {
        refresh() ?: return null
        return SearchScope(matchLimit(), generation)
    }

    /**
     * The scan for [key], promoted to most-recent, or `null` when the file is already holding as
     * many unfinished scans as it will.
     *
     * ! Only a finished scan is ever evicted. Dropping one still in progress makes a set of
     * ! readers restart each other from line 0 for ever — `scanned` walks backwards and no count
     * ! reaches `complete`. Refusing the newcomer bounds that to whoever arrived last.
     */
    private fun openScan(key: String): MatchScan? {
        val existing = matchScans.firstOrNull { it.key == key }
        if (existing != null) {
            matchScans.remove(existing)
            matchScans.addFirst(existing)
            return existing
        }

        if (matchScans.size >= MAX_MATCH_SCANS) {
            // ? A finished scan can go: nobody is polling it any more, and re-deriving it costs a
            // ? rescan nobody is waiting on.
            val limit = matchLimit()
            val done = matchScans.lastOrNull { it.scanned >= limit } ?: return null
            matchScans.remove(done)
        }

        val fresh = MatchScan(key)
        matchScans.addFirst(fresh)
        return fresh
    }

    /**
     * Where [key]'s scan has got to, opening one when it has none. [CURSOR_STALE] when the index
     * was rebuilt under [scope] and the line numbers it holds describe content that is gone;
     * [CURSOR_BUSY] when the file has no room for another scan.
     */
    @Synchronized
    private fun matchCursor(scope: SearchScope, key: String): Int {
        if (generation != scope.generation) return CURSOR_STALE
        return openScan(key)?.scanned ?: CURSOR_BUSY
    }

    /**
     * Folds the first [hitCount] of [hits] into [key]'s scan and advances it to [end].
     *
     * ! The key is checked here, not just the cursor. A slice matched outside the monitor against
     * ! one query must never land in another's scan: the count would report the wrong total, and
     * ! [searchIndexed] would then serve navigation from it without ever running the matcher.
     */
    @Synchronized
    private fun foldMatches(
        scope: SearchScope,
        key: String,
        start: Int,
        end: Int,
        hits: IntArray,
        hitCount: Int,
    ): Int {
        if (generation != scope.generation) return FOLD_STALE

        val scan = matchScans.firstOrNull { it.key == key } ?: return FOLD_SUPERSEDED
        if (scan.scanned != start) return FOLD_SUPERSEDED

        for (index in 0 until hitCount) {
            if (scan.count == scan.lines.size) {
                val grown = if (scan.lines.isEmpty()) INITIAL_OFFSET_CAPACITY else scan.lines.size * 2
                scan.lines = scan.lines.copyOf(grown)
            }
            scan.lines[scan.count++] = hits[index]
        }
        scan.scanned = end

        return FOLD_OK
    }

    /**
     * Lines a scan may cover: every line the file has terminated. A trailing line still being
     * written is left out, because the bytes still to come can change what it matches.
     */
    private fun matchLimit(): Int = if (insideLine) maxOf(0, lineCount - 1) else lineCount

    /** How far the count for [key] has got, as the response body the API hands the client. */
    @Synchronized
    fun matchesJson(key: String): String = buildString {
        append("{\"status\":\"ok\"")
        appendMatchProgress(key)
        append('}')
    }

    /**
     * A search verdict with the count around it. [line] carries one of the `LOG_*` codes when
     * there is no hit, in which case the ordinal is left out with it.
     */
    @Synchronized
    fun searchJson(key: String, mask: Int, line: Long): String = buildString {
        append("{\"status\":\"ok\",\"line\":")
        if (line < 0) append("null") else append(line)

        append(",\"ordinal\":")
        val ordinal = if (line < 0) -1 else ordinalOf(key, mask, line.toInt())
        if (ordinal < 0) append("null") else append(ordinal)

        appendMatchProgress(key)
        append('}')
    }

    /**
     * The next match at or after [fromRequested] in [forward]'s direction, answered from [key]'s
     * scan alone, or `null` when it cannot be: no scan for that query, or one that does not yet
     * cover every line of the file.
     *
     * The bar is [lineCount] rather than [matchLimit], one line stricter than `complete`: a count
     * may round off a half-written trailing line, but navigation that silently skipped it would
     * report a match as absent.
     */
    @Synchronized
    fun searchIndexed(key: String, mask: Int, fromRequested: Long, forward: Boolean): String? {
        refresh() ?: return null

        val scan = matchScans.firstOrNull { it.key == key } ?: return null
        if (scan.scanned < lineCount) return null

        // ! Clamped to the file, not to `Int.MAX_VALUE`: `from + 1` below would overflow to
        // ! `Int.MIN_VALUE` and report a backward search as no match. The scanning path clamps
        // ! the same way, so both answer a large `from` alike.
        val from = fromRequested.coerceIn(0L, lineCount.toLong()).toInt()
        val filtering = isFiltering(mask)
        var line = LOG_NO_MATCH

        var index = if (forward) scan.lowerBound(from) else scan.lowerBound(from + 1) - 1
        val step = if (forward) 1 else -1
        while (index in 0 until scan.count) {
            val match = scan.lines[index]
            if (!filtering || mask and (1 shl levels[match].toInt()) != 0) {
                line = match.toLong()
                break
            }
            index += step
        }

        return searchJson(key, mask, line)
    }

    /**
     * Zero-based position of the match at [line] among the matches [mask] admits, or `-1` when
     * [key] has no scan or the scan has not reached [line] and there is no ordinal to give yet.
     *
     * A walk rather than a binary search because the mask hides an arbitrary subset: the count of
     * admitted matches before a line is not a function of that line's index.
     */
    private fun ordinalOf(key: String, mask: Int, line: Int): Int {
        val scan = matchScans.firstOrNull { it.key == key } ?: return -1
        if (line >= scan.scanned) return -1

        val filtering = isFiltering(mask)
        var ordinal = 0
        for (index in 0 until scan.count) {
            val match = scan.lines[index]
            if (match >= line) break
            if (!filtering || mask and (1 shl levels[match].toInt()) != 0) ordinal++
        }

        return ordinal
    }

    /**
     * The count fields shared by both responses. `levels` is the per-level split of every match
     * found so far, from which the caller derives what its own filter shows and hides — the mask
     * never reaches this class, so a filter change costs no rescan.
     */
    private fun StringBuilder.appendMatchProgress(key: String) {
        // ? Counted per call, like the per-level line counts in `infoJson`. Every folded match
        // ? sits on a terminated line, so its level is settled and the pass cannot disagree with
        // ? what was counted when it was found.
        val scan = matchScans.firstOrNull { it.key == key }
        val counts = IntArray(LEVEL_COUNT)
        if (scan != null) {
            for (index in 0 until scan.count) counts[levels[scan.lines[index]].toInt()]++
        }

        append(",\"total\":")
        append(scan?.count ?: 0)
        append(",\"levels\":[")
        for (code in 0 until LEVEL_COUNT) {
            if (code > 0) append(',')
            append(counts[code])
        }
        append("],\"scanned\":")
        append(scan?.scanned ?: 0)
        append(",\"lines\":")
        append(lineCount)
        append(",\"complete\":")
        append(scan != null && scan.scanned >= matchLimit())
    }

    /** Whether the index still describes the file [scope] was taken against. */
    @Synchronized
    private fun stillCurrent(scope: SearchScope): Boolean {
        refresh() ?: return false
        return generation == scope.generation
    }

    @Synchronized
    private fun searchScope(): SearchScope? {
        refresh() ?: return null
        return SearchScope(lineCount, generation)
    }

    /**
     * The block of lines at [cursor], decoded under the monitor so the caller can match without
     * holding it. `null` ends the search: the file is gone, it no longer reaches [cursor], or it
     * was rebuilt under us and [scope]'s line numbers describe content that is no longer there.
     */
    @Synchronized
    private fun searchBlock(cursor: Int, forward: Boolean, scope: SearchScope): LineBlock? {
        refresh() ?: return null
        if (generation != scope.generation) return null

        val limit = minOf(scope.total, lineCount)
        if (cursor >= limit) return null

        val start = if (forward) cursor else backwardBlockStart(cursor)
        val end = if (forward) forwardBlockEnd(cursor, limit) else cursor + 1
        return LineBlock(start, end, readLines(start, end), levels.copyOfRange(start, end))
    }

    private fun refresh(): BasicFileAttributes? {
        val attrs = readAttributes(path) ?: return null
        if (!attrs.isRegularFile) return null

        val size = attrs.size()
        val key = attrs.fileKey()
        val rotated = !indexed ||
            (key != null && key != fileKey) ||
            size < scannedBytes ||
            (size == scannedBytes && attrs.lastModifiedTime() != lastModified)

        if (rotated) reset()
        if (size > scannedBytes) scan(size)

        indexed = true
        fileKey = key
        lastModified = attrs.lastModifiedTime()

        return attrs
    }

    private fun reset() {
        generation++
        offsets = LongArray(INITIAL_OFFSET_CAPACITY)
        levels = ByteArray(INITIAL_OFFSET_CAPACITY)
        lineCount = 0
        scannedBytes = 0L
        insideLine = false
        headLength = 0
        levelCarry = LEVEL_UNKNOWN
        filteredCount = 0
        filteredScanned = 0
        maskCached = -1
        matchScans.clear()
    }

    private fun scan(endPos: Long) {
        try {
            FileChannel.open(path, StandardOpenOption.READ).use { channel ->
                var pos = scannedBytes
                channel.position(pos)

                val buffer = ByteBuffer.allocate(SCAN_BUFFER_SIZE)
                val bytes = buffer.array()

                while (pos < endPos) {
                    buffer.clear()
                    val remaining = endPos - pos
                    if (remaining < SCAN_BUFFER_SIZE) buffer.limit(remaining.toInt())

                    val read = channel.read(buffer)
                    if (read <= 0) break

                    var i = 0
                    while (i < read) {
                        if (!insideLine) {
                            appendLine(pos + i)
                            insideLine = true
                            headLength = 0
                        }
                        var j = i
                        while (j < read && bytes[j] != NEWLINE) j++
                        captureHead(bytes, i, j)
                        if (j < read) {
                            classifyLine(true)
                            insideLine = false
                            i = j + 1
                        } else {
                            i = read
                        }
                    }

                    pos += read
                }

                // ? The trailing line of a live file has no newline yet, so it is classified
                // ? provisionally and the carry left where it is: the bytes still to come can
                // ? turn what currently looks like a continuation into an entry.
                if (insideLine) classifyLine(false)

                scannedBytes = pos
            }
        } catch (e: IOException) {
            reset()
            throw RuntimeException("Failed to index log '${path.fileName}': ${e.message}", e)
        }
    }

    private fun appendLine(value: Long) {
        if (lineCount == offsets.size) {
            offsets = offsets.copyOf(offsets.size * 2)
            levels = levels.copyOf(levels.size * 2)
        }
        offsets[lineCount] = value
        levels[lineCount] = LEVEL_UNKNOWN
        lineCount++
    }

    private fun captureHead(source: ByteArray, from: Int, to: Int) {
        val room = HEAD_CAPACITY - headLength
        if (room <= 0) return
        val length = minOf(to - from, room)
        System.arraycopy(source, from, head, headLength, length)
        headLength += length
    }

    /** A line declaring no level of its own belongs to the entry above it. */
    private fun classifyLine(advanceCarry: Boolean) {
        if (lineCount == 0) return
        val own = classifyHead(head, headLength)
        val effective = if (own == LEVEL_UNKNOWN) levelCarry else own
        levels[lineCount - 1] = effective
        if (advanceCarry) levelCarry = effective
    }

    private fun lineEnd(line: Int): Long =
        if (line + 1 < lineCount) offsets[line + 1] else scannedBytes

    /**
     * End of the longest line span from [start] that stays inside [maxBytes], never past [limit].
     * Returns [start] when the first line alone is over budget: that line is reachable only
     * through a download, and a bounded response matters more than serving it here.
     */
    private fun budgetedEnd(start: Int, limit: Int, maxBytes: Long): Int {
        var end = start
        while (end < limit && lineEnd(end) - offsets[start] <= maxBytes) end++
        return end
    }

    private fun forwardBlockEnd(start: Int, limit: Int): Int {
        val maxEnd = minOf(limit, start + SEARCH_BLOCK_LINES)
        var end = start + 1
        while (end < maxEnd && lineEnd(end - 1) - offsets[start] < SEARCH_BLOCK_BYTES) end++
        return end
    }

    private fun backwardBlockStart(end: Int): Int {
        val minStart = maxOf(0, end - SEARCH_BLOCK_LINES + 1)
        var start = end
        while (start > minStart && lineEnd(end) - offsets[start - 1] < SEARCH_BLOCK_BYTES) start--
        return start
    }

    private fun readLines(fromLine: Int, toLine: Int): List<String> {
        if (fromLine >= toLine) return emptyList()

        val startByte = offsets[fromLine]
        val endByte = lineEnd(toLine - 1)
        val length = (endByte - startByte).coerceAtLeast(0L).toInt()
        val bytes = ByteArray(length)

        if (length > 0) {
            try {
                FileChannel.open(path, StandardOpenOption.READ).use { channel ->
                    val buffer = ByteBuffer.wrap(bytes)
                    var pos = startByte
                    while (buffer.hasRemaining()) {
                        val read = channel.read(buffer, pos)
                        if (read <= 0) break
                        pos += read
                    }
                }
            } catch (e: IOException) {
                throw RuntimeException("Failed to read log '${path.fileName}': ${e.message}", e)
            }
        }

        val decoder = Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPLACE)
            .onUnmappableCharacter(CodingErrorAction.REPLACE)

        val lines = ArrayList<String>(toLine - fromLine)

        for (line in fromLine until toLine) {
            val start = (offsets[line] - startByte).coerceIn(0L, length.toLong()).toInt()
            var end = (lineEnd(line) - startByte).coerceIn(start.toLong(), length.toLong()).toInt()
            if (end > start && bytes[end - 1] == NEWLINE) end--
            if (end > start && bytes[end - 1] == CARRIAGE_RETURN) end--
            lines += decoder.decode(ByteBuffer.wrap(bytes, start, end - start)).toString()
        }

        return lines
    }
}

internal object LogIndexCache {
    private val indexes = object : LinkedHashMap<Path, LogLineIndex>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Path, LogLineIndex>): Boolean =
            size > MAX_CACHED_INDEXES
    }

    @Synchronized
    fun get(path: Path): LogLineIndex {
        val key = path.toAbsolutePath().normalize()
        return indexes.getOrPut(key) { LogLineIndex(key) }
    }

    @Synchronized
    fun clear() = indexes.clear()

    @Synchronized
    fun size(): Int = indexes.size
}
