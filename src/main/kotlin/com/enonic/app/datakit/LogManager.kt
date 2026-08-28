package com.enonic.app.datakit

import com.enonic.xp.home.HomeDir
import com.google.common.io.ByteSource
import com.google.common.io.Files as GuavaFiles
import org.osgi.service.component.annotations.Component
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.charset.CodingErrorAction
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.BasicFileAttributes
import java.nio.file.attribute.FileTime
import java.util.regex.Pattern
import java.util.regex.PatternSyntaxException

private val LOG_NAME_REGEX = """[A-Za-z0-9][A-Za-z0-9._-]*\.log""".toRegex()
private val ROTATED_LOG_NAME_REGEX = """.+\.\d{4}-\d{2}-\d{2}\.\d+\.log""".toRegex()

private const val SCAN_BUFFER_SIZE = 1 shl 20
private const val MIN_READ_COUNT = 1
private const val MAX_READ_COUNT = 1000
private const val SEARCH_BLOCK_LINES = 2048
private const val SEARCH_BLOCK_BYTES = 4L shl 20
private const val MAX_READ_BYTES = 20L shl 20
private const val MATCH_BUDGET_MILLIS = 1000L
private const val SEARCH_BUDGET_MILLIS = 30_000L
private const val DEADLINE_CHECK_INTERVAL = 4096
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

@Component(immediate = true)
class LogManager {
    /** Test seam: when set, replaces `$XP_HOME/logs` as the directory the bean reads. */
    internal var logsDirOverride: Path? = null

    /** Test seam: milliseconds a regex may spend on one line before the search aborts. */
    internal var matchBudgetMillis: Long = MATCH_BUDGET_MILLIS

    /** Test seam: milliseconds a whole search may run before it aborts. */
    internal var searchBudgetMillis: Long = SEARCH_BUDGET_MILLIS

    /** Test seam: bytes of line content a single read response may carry. */
    internal var maxReadBytes: Long = MAX_READ_BYTES

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
     * Returns the matching line number, [LOG_NO_MATCH] when nothing matches, [LOG_NOT_FOUND] when
     * the file name is invalid or the file is missing, or [LOG_SEARCH_ABORTED] when a regex ran
     * past its time budget. Throws [IllegalArgumentException] for an empty query or an invalid
     * regular expression.
     */
    fun search(
        name: String?,
        query: String?,
        from: Long,
        forward: Boolean,
        regex: Boolean,
        caseSensitive: Boolean,
    ): Long {
        val matcher = lineMatcher(query, regex, caseSensitive, matchBudgetMillis)
        val file = resolveLogFile(name) ?: return LOG_NOT_FOUND
        return try {
            LogIndexCache.get(file).search(matcher, from, forward, searchBudgetMillis)
        } catch (_: MatchTimeoutException) {
            LOG_SEARCH_ABORTED
        } catch (_: StackOverflowError) {
            // ! Some patterns exhaust the stack before the deadline check runs. Matching mutates no
            // ! index state and the monitor unwinds with it, so the search is simply over.
            LOG_SEARCH_ABORTED
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

private fun lineMatcher(
    query: String?,
    regex: Boolean,
    caseSensitive: Boolean,
    budgetMillis: Long,
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

    // ? Per line, not per search: a multi-gigabyte scan legitimately takes seconds, while no
    // ? single line needs a second unless the pattern is backtracking wildly.
    // ! Reached only through `get`, so a match that consumes no character is bounded by neither
    // ! this nor the whole-search deadline, which is checked between lines.
    val budgetNanos = budgetMillis * 1_000_000L
    return { line -> pattern.matcher(DeadlineInput(line, System.nanoTime() + budgetNanos)).find() }
}

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

    @Synchronized
    fun search(
        matches: (String) -> Boolean,
        fromRequested: Long,
        forward: Boolean,
        budgetMillis: Long,
    ): Long {
        refresh() ?: return LOG_NOT_FOUND
        if (lineCount == 0) return LOG_NO_MATCH

        val from = fromRequested.coerceAtLeast(0)
        // ! A per-line bound leaves the total at per-line cost times line count, and this method
        // ! holds the file's index monitor throughout — so reads and info polls wait on it.
        val deadlineNanos = System.nanoTime() + budgetMillis * 1_000_000L

        if (forward) {
            if (from >= lineCount) return LOG_NO_MATCH
            var start = from.toInt()
            while (start < lineCount) {
                val end = forwardBlockEnd(start)
                val lines = readLines(start, end)
                for ((index, line) in lines.withIndex()) {
                    if (System.nanoTime() - deadlineNanos >= 0) return LOG_SEARCH_ABORTED
                    if (matches(line)) return (start + index).toLong()
                }
                start = end
            }
            return LOG_NO_MATCH
        }

        var end = minOf(from, (lineCount - 1).toLong()).toInt()
        while (end >= 0) {
            val start = backwardBlockStart(end)
            val lines = readLines(start, end + 1)
            for (index in lines.indices.reversed()) {
                if (System.nanoTime() - deadlineNanos >= 0) return LOG_SEARCH_ABORTED
                if (matches(lines[index])) return (start + index).toLong()
            }
            end = start - 1
        }
        return LOG_NO_MATCH
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

    private fun forwardBlockEnd(start: Int): Int {
        val maxEnd = minOf(lineCount, start + SEARCH_BLOCK_LINES)
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
