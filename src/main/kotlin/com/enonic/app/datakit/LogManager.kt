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
private const val MAX_CACHED_INDEXES = 4
private const val INITIAL_OFFSET_CAPACITY = 1024

private const val NEWLINE = '\n'.code.toByte()
private const val CARRIAGE_RETURN = '\r'.code.toByte()

internal const val LOG_NOT_FOUND = -2L
internal const val LOG_NO_MATCH = -1L

@Component(immediate = true)
class LogManager {
    /** Test seam: when set, replaces `$XP_HOME/logs` as the directory the bean reads. */
    internal var logsDirOverride: Path? = null

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

    fun info(name: String?): String? {
        val file = resolveLogFile(name) ?: return null
        val snapshot = LogIndexCache.get(file).snapshot() ?: return null

        return buildString {
            append("{\"name\":")
            append(jsonString(file.fileName.toString()))
            append(",\"size\":")
            append(snapshot.size)
            append(",\"modified\":")
            append(jsonString(snapshot.modified))
            append(",\"lines\":")
            append(snapshot.lines)
            append('}')
        }
    }

    fun read(name: String?, from: Long, count: Int): String? {
        val file = resolveLogFile(name) ?: return null
        return LogIndexCache.get(file).readJson(from, count)
    }

    /**
     * Returns the matching line number, [LOG_NO_MATCH] when nothing matches, or [LOG_NOT_FOUND]
     * when the file name is invalid or the file is missing. Throws [IllegalArgumentException]
     * for an empty query or an invalid regular expression.
     */
    fun search(
        name: String?,
        query: String?,
        from: Long,
        forward: Boolean,
        regex: Boolean,
        caseSensitive: Boolean,
    ): Long {
        val matcher = lineMatcher(query, regex, caseSensitive)
        val file = resolveLogFile(name) ?: return LOG_NOT_FOUND
        return LogIndexCache.get(file).search(matcher, from, forward)
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

private fun lineMatcher(query: String?, regex: Boolean, caseSensitive: Boolean): (String) -> Boolean {
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

    return { line -> pattern.matcher(line).find() }
}

private fun readAttributes(path: Path): BasicFileAttributes? =
    try {
        Files.readAttributes(path, BasicFileAttributes::class.java)
    } catch (_: IOException) {
        null
    }

internal class LogSnapshot(val lines: Int, val size: Long, val modified: String)

/**
 * Byte offset of the first character of every line in a log file.
 *
 * A line is any run of bytes terminated by `\n`; a trailing run without `\n` counts as a line too,
 * so an appended chunk simply continues it. The index is extended when the file grows and rebuilt
 * when it shrinks or changes identity (rotation).
 */
internal class LogLineIndex(private val path: Path) {
    private var offsets = LongArray(INITIAL_OFFSET_CAPACITY)
    private var lineCount = 0
    private var scannedBytes = 0L
    private var insideLine = false
    private var indexed = false
    private var fileKey: Any? = null
    private var lastModified: FileTime? = null

    @Synchronized
    fun snapshot(): LogSnapshot? {
        val attrs = refresh() ?: return null
        return LogSnapshot(lineCount, attrs.size(), attrs.lastModifiedTime().toInstant().toString())
    }

    @Synchronized
    fun readJson(fromRequested: Long, countRequested: Int): String? {
        val attrs = refresh() ?: return null

        val from = fromRequested.coerceAtLeast(0)
        val count = countRequested.coerceIn(MIN_READ_COUNT, MAX_READ_COUNT)
        val fromLine = if (from >= lineCount) lineCount else from.toInt()
        val toLine = minOf(lineCount.toLong(), fromLine.toLong() + count).toInt()
        val lines = readLines(fromLine, toLine)

        return buildString {
            append("{\"from\":")
            append(from)
            append(",\"lines\":[")
            for ((index, line) in lines.withIndex()) {
                if (index > 0) append(',')
                append(jsonString(line))
            }
            append("],\"total\":")
            append(lineCount)
            append(",\"size\":")
            append(attrs.size())
            append('}')
        }
    }

    @Synchronized
    fun search(matches: (String) -> Boolean, fromRequested: Long, forward: Boolean): Long {
        refresh() ?: return LOG_NOT_FOUND
        if (lineCount == 0) return LOG_NO_MATCH

        val from = fromRequested.coerceAtLeast(0)

        if (forward) {
            if (from >= lineCount) return LOG_NO_MATCH
            var start = from.toInt()
            while (start < lineCount) {
                val end = forwardBlockEnd(start)
                val lines = readLines(start, end)
                for ((index, line) in lines.withIndex()) {
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
        lineCount = 0
        scannedBytes = 0L
        insideLine = false
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
                            appendOffset(pos + i)
                            insideLine = true
                        }
                        var j = i
                        while (j < read && bytes[j] != NEWLINE) j++
                        if (j < read) {
                            insideLine = false
                            i = j + 1
                        } else {
                            i = read
                        }
                    }

                    pos += read
                }

                scannedBytes = pos
            }
        } catch (e: IOException) {
            reset()
            throw RuntimeException("Failed to index log '${path.fileName}': ${e.message}", e)
        }
    }

    private fun appendOffset(value: Long) {
        if (lineCount == offsets.size) {
            offsets = offsets.copyOf(offsets.size * 2)
        }
        offsets[lineCount++] = value
    }

    private fun lineEnd(line: Int): Long =
        if (line + 1 < lineCount) offsets[line + 1] else scannedBytes

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
