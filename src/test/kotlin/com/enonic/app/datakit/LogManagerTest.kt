package com.enonic.app.datakit

import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.FileTime
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val WHOLE_FILE = """{"line":0,"time":null}"""

private val NUMBER_REGEX = """"([a-zA-Z]+)":(-?\d+)""".toRegex()

class LogManagerTest {
    @TempDir
    lateinit var logsDir: Path

    private lateinit var manager: LogManager

    @BeforeEach
    fun setUp() {
        LogIndexCache.clear()
        manager = LogManager()
        manager.logsDirOverride = logsDir
    }

    //
    // * list
    //

    @Test
    fun `list returns empty array when the logs directory is missing`() {
        manager.logsDirOverride = logsDir.resolve("nope")
        assertEquals("[]", manager.list())
    }

    @Test
    fun `list returns only regular log files, newest first, with the newest marked active`() {
        writeLog("old.log", "a\n", modifiedMillis = 1_000_000)
        writeLog("server.log", "b\n", modifiedMillis = 3_000_000)
        writeLog("middle.log", "c\n", modifiedMillis = 2_000_000)
        writeLog("notes.txt", "d\n")
        Files.createDirectory(logsDir.resolve("nested.log"))

        val json = manager.list()

        assertEquals(
            listOf("server.log", "middle.log", "old.log"),
            Regex(""""name":"([^"]+)"""").findAll(json).map { it.groupValues[1] }.toList(),
        )
        assertEquals(1, Regex("\"active\":true").findAll(json).count())
        assertTrue(json.startsWith("[{\"name\":\"server.log\",\"size\":2,\"modified\":\""))
        assertTrue(json.contains("\"active\":false"))
    }

    @Test
    fun `list omits names the file API would reject`() {
        writeLog("server.log", "a\n", modifiedMillis = 1_000_000)
        writeLog(".hidden.log", "b\n", modifiedMillis = 3_000_000)
        writeLog("_old.log", "c\n", modifiedMillis = 2_000_000)
        writeLog("2026 server.log", "d\n", modifiedMillis = 2_500_000)
        writeLog("\u00fcber.log", "e\n", modifiedMillis = 2_800_000)

        val json = manager.list()

        assertEquals(
            listOf("server.log"),
            Regex(""""name":"([^"]+)"""").findAll(json).map { it.groupValues[1] }.toList(),
        )
        assertTrue(json.contains("\"active\":true"))
    }

    @Test
    fun `list marks the unrotated file active even when a rotation is newer`() {
        writeLog("server.log", "a\n", modifiedMillis = 1_000_000)
        writeLog("server.2026-08-27.0.log", "b\n", modifiedMillis = 3_000_000)
        writeLog("server.2026-08-26.0.log", "c\n", modifiedMillis = 2_000_000)

        val json = manager.list()

        assertEquals(
            listOf("server.log", "server.2026-08-27.0.log", "server.2026-08-26.0.log"),
            Regex(""""name":"([^"]+)"""").findAll(json).map { it.groupValues[1] }.toList(),
        )
        assertEquals(listOf("server.log"), activeNames(json))
        assertEquals(
            listOf("server.2026-08-27.0.log", "server.2026-08-26.0.log"),
            rotatedNames(json),
        )
    }

    @Test
    fun `list falls back to the newest file when every file is rotated`() {
        writeLog("server.2026-08-27.0.log", "b\n", modifiedMillis = 3_000_000)
        writeLog("server.2026-08-26.0.log", "c\n", modifiedMillis = 2_000_000)

        val json = manager.list()

        assertEquals(
            listOf("server.2026-08-27.0.log", "server.2026-08-26.0.log"),
            Regex(""""name":"([^"]+)"""").findAll(json).map { it.groupValues[1] }.toList(),
        )
        assertEquals(listOf("server.2026-08-27.0.log"), activeNames(json))
        // ? The stand-in active file keeps `rotated:false` even though its name says otherwise:
        // ? it is the file the tool opens, and reporting it unfollowable would leave the view
        // ? with no live file at all.
        assertEquals(listOf("server.2026-08-26.0.log"), rotatedNames(json))
    }

    @Test
    fun `list reports a second unrotated file as still writable`() {
        writeLog("server.log", "a\n", modifiedMillis = 3_000_000)
        writeLog("audit.log", "b\n", modifiedMillis = 2_000_000)
        writeLog("server.2026-08-27.0.log", "c\n", modifiedMillis = 1_000_000)

        val json = manager.list()

        assertEquals(listOf("server.log"), activeNames(json))
        assertEquals(listOf("server.2026-08-27.0.log"), rotatedNames(json))
    }

    //
    // * info
    //

    @Test
    fun `info counts lines and reports size`() {
        writeLog("server.log", "one\ntwo\nthree\n")

        val json = assertNotNull(manager.info("server.log", 0, 0L))

        assertEquals(3, number(json, "lines"))
        assertEquals(14, number(json, "size"))
        assertTrue(json.startsWith("{\"name\":\"server.log\""))
    }

    @Test
    fun `info returns null for a missing file`() {
        assertNull(manager.info("server.log", 0, 0L))
    }

    @Test
    fun `empty file has zero lines and reads as an empty list`() {
        writeLog("server.log", "")

        assertEquals(0, number(assertNotNull(manager.info("server.log", 0, 0L)), "lines"))
        assertEquals(
            """{"from":0,"lines":[],"total":0,"size":0}""",
            manager.read("server.log", 0, 200, 0, 0L),
        )
    }

    @Test
    fun `a trailing line without a newline still counts`() {
        writeLog("server.log", "one\ntwo")

        assertEquals(2, number(assertNotNull(manager.info("server.log", 0, 0L)), "lines"))
        assertEquals(listOf("one", "two"), readLines("server.log", 0, 200))
    }

    //
    // * read
    //

    @Test
    fun `read strips the trailing carriage return of CRLF lines`() {
        writeLog("server.log", "one\r\ntwo\r\nthree")

        assertEquals(listOf("one", "two", "three"), readLines("server.log", 0, 200))
    }

    @Test
    fun `read decodes multibyte UTF-8 and keeps the offsets aligned`() {
        writeLog("server.log", "ñ ü\n日本語\n🚀 emoji\nplain\n")

        assertEquals(4, number(assertNotNull(manager.info("server.log", 0, 0L)), "lines"))
        assertEquals(listOf("ñ ü", "日本語", "🚀 emoji", "plain"), readLines("server.log", 0, 200))
        assertEquals(listOf("日本語"), readLines("server.log", 1, 1))
    }

    @Test
    fun `read replaces malformed UTF-8 bytes`() {
        Files.write(logsDir.resolve("server.log"), byteArrayOf(0x61, 0xFF.toByte(), 0x62, 0x0A))

        assertEquals(listOf("a�b"), readLines("server.log", 0, 200))
    }

    @Test
    fun `read returns a very long line untruncated`() {
        val long = "x".repeat(200_000)
        writeLog("server.log", "short\n$long\nafter\n")

        val lines = readLines("server.log", 0, 200)
        assertEquals(3, lines.size)
        assertEquals(200_000, lines[1].length)
        assertEquals("after", lines[2])
    }

    @Test
    fun `read returns an empty list at and past EOF`() {
        writeLog("server.log", "one\ntwo\n")

        assertEquals(emptyList(), readLines("server.log", 2, 10))
        assertEquals(emptyList(), readLines("server.log", 99, 10))
        assertEquals(99, number(assertNotNull(manager.read("server.log", 99, 10, 0, 0L)), "from"))
    }

    @Test
    fun `read returns fewer lines near EOF`() {
        writeLog("server.log", "one\ntwo\nthree\n")

        assertEquals(listOf("two", "three"), readLines("server.log", 1, 10))
    }

    @Test
    fun `read clamps count to the 1 to 1000 range`() {
        writeLog("server.log", (0 until 1500).joinToString("") { "line-$it\n" })

        assertEquals(1, readLines("server.log", 0, 0).size)
        assertEquals(1, readLines("server.log", 0, -5).size)
        assertEquals(1000, readLines("server.log", 0, 5000).size)
        assertEquals(listOf("line-0"), readLines("server.log", -3, 1))
    }

    @Test
    fun `read keeps the whole response inside the byte cap`() {
        manager.maxReadBytes = 200
        writeLog("server.log", (0 until 10).joinToString("") { "line-$it".padEnd(29, '.') + "\n" })

        val json = assertNotNull(manager.read("server.log", 0, 10, 0, 0L))

        assertTrue(json.toByteArray(Charsets.UTF_8).size <= 200)
        // ? A short page, not an empty one: the client needs something to resume from.
        assertTrue(parseLines(json).size in 1..9)
        assertEquals(10, number(json, "total"))
    }

    @Test
    fun `read returns an empty page when the first line alone exceeds the byte cap`() {
        manager.maxReadBytes = 10
        writeLog("server.log", "x".repeat(50) + "\nshort\n")

        val json = assertNotNull(manager.read("server.log", 0, 10, 0, 0L))

        assertEquals(emptyList(), parseLines(json))
        assertEquals(2, number(json, "total"))
        assertEquals(0, number(json, "from"))
    }

    @Test
    fun `read counts JSON escaping against the byte cap`() {
        manager.maxReadBytes = 150
        writeLog("server.log", "plain\n" + "\u0000".repeat(20) + "\n")

        // ? Line 1 is 21 raw bytes but 122 once escaped, so it does not fit where its raw size would.
        assertEquals(listOf("plain"), readLines("server.log", 0, 10))
    }

    @Test
    fun `read counts multi-byte characters as their encoded width`() {
        // ? 330 CJK chars: 332 characters as JSON, but 992 bytes. A budget counted in characters
        // ? admits the line and emits 1034 bytes under a 1000-byte cap.
        writeLog("server.log", "\u4e00".repeat(330) + "\n")

        manager.maxReadBytes = 1000
        val capped = assertNotNull(manager.read("server.log", 0, 10, 0, 0L))
        assertEquals(emptyList(), parseLines(capped))
        assertTrue(capped.toByteArray(Charsets.UTF_8).size <= 1000)

        manager.maxReadBytes = 2000
        assertEquals(1, parseLines(assertNotNull(manager.read("server.log", 0, 10, 0, 0L))).size)
    }

    @Test
    fun `read reports the current total and size`() {
        writeLog("server.log", "one\ntwo\n")

        val json = assertNotNull(manager.read("server.log", 0, 1, 0, 0L))
        assertEquals(2, number(json, "total"))
        assertEquals(8, number(json, "size"))
        assertEquals(0, number(json, "from"))
    }

    @Test
    fun `read escapes control characters in line content`() {
        writeLog("server.log", "a\"b\\c\td\n")

        assertEquals("""{"from":0,"lines":["a\"b\\c\td"],"total":1,"size":8}""", manager.read("server.log", 0, 5, 0, 0L))
    }

    //
    // * levels
    //

    @Test
    fun `info counts every line at the level of the entry it belongs to`() {
        writeLog(
            "server.log",
            entry("INFO", "started") +
                entry("ERROR", "boom") +
                "java.lang.NullPointerException: nope\n" +
                "\tat com.enonic.Foo.bar(Foo.java:1)\n" +
                entry("WARN", "slow"),
        )

        val json = assertNotNull(manager.info("server.log", 0, 0L))

        assertEquals(5, number(json, "lines"))
        assertEquals(1, number(json, "info"))
        assertEquals(3, number(json, "error"))
        assertEquals(1, number(json, "warn"))
        assertEquals(0, number(json, "unknown"))
    }

    @Test
    fun `a continuation with no entry above it stays unknown`() {
        writeLog("server.log", "\tat com.enonic.Foo.bar(Foo.java:1)\n" + entry("INFO", "started"))

        val json = assertNotNull(manager.info("server.log", 0, 0L))

        assertEquals(1, number(json, "unknown"))
        assertEquals(1, number(json, "info"))
    }

    @Test
    fun `a line that only looks like an entry is a continuation`() {
        writeLog(
            "server.log",
            entry("INFO", "started") +
                "08:00:00.000 ERROR no-separator-here\n" +
                "08:00:00.000 FATAL c.e.x.Test - unknown level\n" +
                "not a timestamp ERROR c.e.x.Test - nope\n",
        )

        val json = assertNotNull(manager.info("server.log", 0, 0L))

        assertEquals(4, number(json, "info"))
        assertEquals(0, number(json, "error"))
    }

    @Test
    fun `an entry head straddling the scan buffer is still classified`() {
        // ? The scanner reads a megabyte at a time, so land an ERROR head across that seam.
        val seam = 1 shl 20
        val builder = StringBuilder()
        while (builder.length < seam - 300) builder.append(entry("INFO", "x".repeat(200)))
        builder.append("#".repeat(seam - 20 - builder.length - 1)).append('\n')
        builder.append(entry("ERROR", "straddled"))

        writeLog("server.log", builder.toString())

        val lines = parseLines(assertNotNull(manager.read("server.log", 0, 10, mask(LEVEL_ERROR), 0L)))

        assertEquals(1, lines.size)
        assertTrue(lines[0].endsWith("straddled"), lines[0])
    }

    @Test
    fun `a trailing line becomes an entry once the rest of its head arrives`() {
        val file = writeLog("server.log", entry("INFO", "first") + "08:00:01.000 ERROR c.e.x.Test")

        val partial = assertNotNull(manager.info("server.log", 0, 0L))
        assertEquals(0, number(partial, "error"))
        assertEquals(2, number(partial, "info"))

        append(file, " - boom\n")

        val whole = assertNotNull(manager.info("server.log", 0, 0L))
        assertEquals(1, number(whole, "error"))
        assertEquals(1, number(whole, "info"))
    }

    @Test
    fun `a mask admitting every level takes the unfiltered path`() {
        writeLog("server.log", entry("INFO", "a") + entry("ERROR", "b"))

        val json = assertNotNull(manager.read("server.log", 0, 10, LEVEL_MASK_ALL, 0L))

        assertFalse(json.contains("\"numbers\""), json)
        assertEquals(2, number(json, "total"))
    }

    @Test
    fun `a filtered read carries the entry's own frames and their physical line numbers`() {
        writeLog(
            "server.log",
            entry("INFO", "started") +
                entry("ERROR", "boom") +
                "java.lang.NullPointerException: nope\n" +
                entry("DEBUG", "tick"),
        )

        val json = assertNotNull(manager.read("server.log", 0, 10, mask(LEVEL_ERROR), 0L))
        val lines = parseLines(json)

        assertEquals(listOf(1, 2), parseNumbers(json))
        assertEquals(2, number(json, "total"))
        assertEquals(2, lines.size)
        assertTrue(lines[0].endsWith("boom"), lines[0])
        assertEquals("java.lang.NullPointerException: nope", lines[1])
    }

    @Test
    fun `a filtered read pages in filtered positions`() {
        val builder = StringBuilder()
        for (i in 0 until 10) builder.append(entry("INFO", "i$i")).append(entry("ERROR", "e$i"))
        writeLog("server.log", builder.toString())

        val json = assertNotNull(manager.read("server.log", 1, 2, mask(LEVEL_ERROR), 0L))

        assertEquals(listOf(3, 5), parseNumbers(json))
        assertEquals(1, number(json, "from"))
        assertEquals(10, number(json, "total"))
    }

    @Test
    fun `a filtered read stops at the byte budget rather than spanning the gaps`() {
        val builder = StringBuilder()
        for (i in 0 until 5) {
            builder.append(entry("ERROR", "e$i"))
            builder.append(entry("DEBUG", "d".repeat(500)))
        }
        writeLog("server.log", builder.toString())

        manager.maxReadBytes = 200
        val json = assertNotNull(manager.read("server.log", 0, 10, mask(LEVEL_ERROR), 0L))
        val lines = parseLines(json)

        assertTrue(lines.size in 1..4, "expected a truncated page, got ${lines.size}")
        assertEquals(lines.size, parseNumbers(json).size)
        assertEquals(5, number(json, "total"))
    }

    @Test
    fun `switching the mask reindexes the view`() {
        writeLog("server.log", entry("INFO", "a") + entry("WARN", "b") + entry("ERROR", "c"))

        assertEquals(listOf(2), filteredNumbers("server.log", mask(LEVEL_ERROR)))
        assertEquals(listOf(1, 2), filteredNumbers("server.log", mask(LEVEL_WARN, LEVEL_ERROR)))
        assertEquals(listOf(0), filteredNumbers("server.log", mask(LEVEL_INFO)))
        assertEquals(listOf(2), filteredNumbers("server.log", mask(LEVEL_ERROR)))
    }

    @Test
    fun `a filtered view picks up entries appended after it was built`() {
        val file = writeLog("server.log", entry("INFO", "a") + entry("ERROR", "b"))
        val errors = mask(LEVEL_ERROR)

        assertEquals(listOf(1), filteredNumbers("server.log", errors))

        append(file, entry("DEBUG", "c") + entry("ERROR", "d"))

        assertEquals(listOf(1, 3), filteredNumbers("server.log", errors))
    }

    @Test
    fun `a filtered view drops a trailing hit the file has since rewritten`() {
        val file = writeLog("server.log", entry("INFO", "a") + "08:00:01.000 ERROR c.e.x.Test - b")
        val errors = mask(LEVEL_ERROR)

        assertEquals(listOf(1), filteredNumbers("server.log", errors))

        // ? Appending to the open trailing line leaves it one line, still the only hit.
        append(file, " continued\n")

        assertEquals(listOf(1), filteredNumbers("server.log", errors))
        assertEquals(2, number(assertNotNull(manager.info("server.log", 0, 0L)), "lines"))
    }

    @Test
    fun `a filtered view is rebuilt when the file is replaced`() {
        writeLog("server.log", entry("ERROR", "a") + entry("ERROR", "b"))
        val errors = mask(LEVEL_ERROR)

        assertEquals(2, number(assertNotNull(manager.read("server.log", 0, 10, errors, 0L)), "total"))

        writeLog("server.log", entry("INFO", "c"))

        assertEquals(0, number(assertNotNull(manager.read("server.log", 0, 10, errors, 0L)), "total"))
    }

    @Test
    fun `info reports the filtered count only while a filter is active`() {
        writeLog("server.log", entry("INFO", "a") + entry("ERROR", "b") + "\tat Foo.bar\n")

        val unfiltered = assertNotNull(manager.info("server.log", 0, 0L))
        assertFalse(unfiltered.contains("\"filtered\""), unfiltered)

        val filtered = assertNotNull(manager.info("server.log", mask(LEVEL_ERROR), 0L))
        assertEquals(3, number(filtered, "lines"))
        assertEquals(2, number(filtered, "filtered"))
    }

    //
    // * locate
    //

    @Test
    fun `locate maps a visible line onto its filtered position`() {
        writeLog(
            "server.log",
            entry("INFO", "a") + entry("ERROR", "b") + "\tat Foo.bar\n" + entry("ERROR", "c"),
        )
        val errors = mask(LEVEL_ERROR)

        assertEquals("""{"position":0,"visible":true}""", manager.locate("server.log", errors, 1, 0L))
        assertEquals("""{"position":1,"visible":true}""", manager.locate("server.log", errors, 2, 0L))
        assertEquals("""{"position":2,"visible":true}""", manager.locate("server.log", errors, 3, 0L))
    }

    @Test
    fun `locate falls back to the entry above a hidden line`() {
        writeLog(
            "server.log",
            entry("INFO", "a") + entry("ERROR", "b") + entry("INFO", "c") + entry("INFO", "d"),
        )
        val errors = mask(LEVEL_ERROR)

        assertEquals("""{"position":0,"visible":false}""", manager.locate("server.log", errors, 2, 0L))
        assertEquals("""{"position":0,"visible":false}""", manager.locate("server.log", errors, 3, 0L))
        // ? Nothing visible above line 0, so the head of the view is the only answer.
        assertEquals("""{"position":0,"visible":false}""", manager.locate("server.log", errors, 0, 0L))
    }

    @Test
    fun `locate reports the head of an empty filtered view`() {
        writeLog("server.log", entry("INFO", "a"))

        assertEquals(
            """{"position":0,"visible":false}""",
            manager.locate("server.log", mask(LEVEL_ERROR), 4, 0L),
        )
    }

    @Test
    fun `locate clamps to the file when no filter is active`() {
        writeLog("server.log", entry("INFO", "a") + entry("ERROR", "b"))

        assertEquals("""{"position":1,"visible":true}""", manager.locate("server.log", 0, 1, 0L))
        assertEquals("""{"position":1,"visible":true}""", manager.locate("server.log", 0, 99, 0L))
        assertEquals("""{"position":0,"visible":true}""", manager.locate("server.log", 0, -5, 0L))
        assertNull(manager.locate("missing.log", 0, 0, 0L))
        assertNull(manager.locate(null, 0, 0, 0L))
    }

    //
    // * index maintenance
    //

    @Test
    fun `appending to an indexed file extends the index`() {
        val file = writeLog("server.log", "one\ntwo\n")
        assertEquals(2, number(assertNotNull(manager.info("server.log", 0, 0L)), "lines"))

        append(file, "three\nfour\n")

        assertEquals(4, number(assertNotNull(manager.info("server.log", 0, 0L)), "lines"))
        assertEquals(listOf("three", "four"), readLines("server.log", 2, 10))
    }

    @Test
    fun `appending to a partial last line completes it instead of adding one`() {
        val file = writeLog("server.log", "one\npar")
        assertEquals(2, number(assertNotNull(manager.info("server.log", 0, 0L)), "lines"))

        append(file, "tial\nthree\n")

        assertEquals(3, number(assertNotNull(manager.info("server.log", 0, 0L)), "lines"))
        assertEquals(listOf("one", "partial", "three"), readLines("server.log", 0, 10))
    }

    @Test
    fun `truncating a file rebuilds the index`() {
        val file = writeLog("server.log", "one\ntwo\nthree\n")
        assertEquals(3, number(assertNotNull(manager.info("server.log", 0, 0L)), "lines"))

        Files.write(file, "only\n".toByteArray())

        assertEquals(1, number(assertNotNull(manager.info("server.log", 0, 0L)), "lines"))
        assertEquals(listOf("only"), readLines("server.log", 0, 10))
    }

    @Test
    fun `rewriting a file with the same size but a newer timestamp rebuilds the index`() {
        val file = writeLog("server.log", "one\ntwo\n", modifiedMillis = 1_000_000)
        assertEquals(2, number(assertNotNull(manager.info("server.log", 0, 0L)), "lines"))

        writeLog("server.log", "1\n2\n3\n4\n", modifiedMillis = 2_000_000)
        assertEquals(8, Files.size(file))

        assertEquals(4, number(assertNotNull(manager.info("server.log", 0, 0L)), "lines"))
    }

    @Test
    fun `replacing a file with a different one rebuilds the index even when size and time match`() {
        val target = writeLog("server.log", "one\ntwo\n", modifiedMillis = 1_000_000)
        assertEquals(2, number(assertNotNull(manager.info("server.log", 0, 0L)), "lines"))

        val replacement = writeLog("staged.txt", "1\n2\n3\n4\n", modifiedMillis = 1_000_000)
        Files.move(replacement, target, StandardCopyOption.REPLACE_EXISTING)
        Files.setLastModifiedTime(target, FileTime.fromMillis(1_000_000))

        assertEquals(4, number(assertNotNull(manager.info("server.log", 0, 0L)), "lines"))
        assertEquals(listOf("1", "2", "3", "4"), readLines("server.log", 0, 10))
    }

    @Test
    fun `the index cache keeps at most four files`() {
        for (i in 0 until 7) {
            writeLog("file-$i.log", "line\n")
            assertNotNull(manager.info("file-$i.log", 0, 0L))
        }

        assertEquals(4, LogIndexCache.size())
    }

    //
    // * search
    //

    @Test
    fun `search finds the first match forward from the given line`() {
        writeLog("server.log", "alpha\nbeta\nalpha\ngamma\n")

        assertEquals(0, searchLine("server.log", "alpha", 0, true, false, false, 0))
        assertEquals(2, searchLine("server.log", "alpha", 1, true, false, false, 0))
        assertEquals(-1, searchLine("server.log", "alpha", 3, true, false, false, 0))
        assertEquals(-1, searchLine("server.log", "alpha", 99, true, false, false, 0))
    }

    @Test
    fun `search finds the previous match backward from the given line`() {
        writeLog("server.log", "alpha\nbeta\nalpha\ngamma\n")

        assertEquals(2, searchLine("server.log", "alpha", 3, false, false, false, 0))
        assertEquals(0, searchLine("server.log", "alpha", 1, false, false, false, 0))
        assertEquals(-1, searchLine("server.log", "beta", 0, false, false, false, 0))
        assertEquals(2, searchLine("server.log", "alpha", 99, false, false, false, 0))
    }

    @Test
    fun `plain search is case-insensitive unless case sensitivity is requested`() {
        writeLog("server.log", "Alpha\nbeta\n")

        assertEquals(0, searchLine("server.log", "alpha", 0, true, false, false, 0))
        assertEquals(-1, searchLine("server.log", "alpha", 0, true, false, true, 0))
        assertEquals(0, searchLine("server.log", "Alpha", 0, true, false, true, 0))
    }

    @Test
    fun `regex search matches anywhere in the line and honours case sensitivity`() {
        writeLog("server.log", "10:00:00.000 INFO  c.e.Foo - started\nplain text\nERROR boom\n")

        assertEquals(2, searchLine("server.log", "^ERROR\\s", 0, true, true, false, 0))
        assertEquals(0, searchLine("server.log", "c\\.e\\.\\w+", 0, true, true, true, 0))
        assertEquals(2, searchLine("server.log", "error", 0, true, true, false, 0))
        assertEquals(-1, searchLine("server.log", "error", 0, true, true, true, 0))
    }

    @Test
    fun `regex search matches unicode case-insensitively`() {
        writeLog("server.log", "ÉCHEC du démarrage\n")

        assertEquals(0, searchLine("server.log", "échec", 0, true, true, false, 0))
    }

    @Test
    fun `search rejects an invalid regex`() {
        writeLog("server.log", "alpha\n")

        val error = assertFailsWith<IllegalArgumentException> {
            searchLine("server.log", "[unclosed", 0, true, true, false, 0)
        }
        assertTrue(error.message?.startsWith("Invalid regular expression") == true)
    }

    @Test
    fun `search rejects an empty query`() {
        writeLog("server.log", "alpha\n")

        assertFailsWith<IllegalArgumentException> {
            searchLine("server.log", "", 0, true, false, false, 0)
        }
        assertFailsWith<IllegalArgumentException> {
            searchLine("server.log", null, 0, true, false, false, 0)
        }
    }

    @Test
    fun `search spans several blocks and an empty file`() {
        writeLog("server.log", (0 until 5000).joinToString("") { "line-$it\n" })

        assertEquals(4999, searchLine("server.log", "line-4999", 0, true, false, false, 0))
        assertEquals(-1, searchLine("server.log", "line-5000", 0, true, false, false, 0))
        assertEquals(4321, searchLine("server.log", "line-4321", 5000, false, false, false, 0))
        assertEquals(2500, searchLine("server.log", "^line-2500$", 0, true, true, false, 0))

        writeLog("empty.log", "")
        assertEquals(-1, searchLine("empty.log", "anything", 0, true, false, false, 0))
    }

    @Test
    fun `regex search aborts when one line runs past the match budget`() {
        manager.matchBudgetMillis = 50
        // ? Java only backtracks exponentially on this pattern once the line is long.
        writeLog("server.log", "harmless\n" + "a".repeat(20_000) + "!\n")

        assertEquals(-3, searchLine("server.log", "(a+)+b", 0, true, true, false, 0))
        assertEquals(-3, searchLine("server.log", "(a+)+b", 1, false, true, false, 0))
    }

    @Test
    fun `the match budget leaves an ordinary regex alone`() {
        manager.matchBudgetMillis = 50
        writeLog("server.log", "alpha\nbeta-42\n")

        assertEquals(1, searchLine("server.log", "beta-\\d+", 0, true, true, false, 0))
        assertEquals(-1, searchLine("server.log", "gamma", 0, true, true, false, 0))
    }

    @Test
    fun `search aborts when the whole scan runs past the search budget`() {
        manager.searchBudgetMillis = 0
        writeLog("server.log", "alpha\nbeta\n")

        assertEquals(-3, searchLine("server.log", "beta", 0, true, false, false, 0))
        assertEquals(-3, searchLine("server.log", "alpha", 1, false, false, false, 0))
    }

    @Test
    fun `regex search aborts instead of propagating a stack overflow`() {
        // ? This pattern exhausts the stack on a long line rather than reaching the deadline.
        writeLog("server.log", "a".repeat(200_000) + "!\n")

        assertEquals(-3, searchLine("server.log", "(a|aa)+b", 0, true, true, false, 0))
    }

    @Test
    fun `a search in progress does not block reads on the same file`() {
        val path = writeLog("server.log", (0 until 5000).joinToString("") { "line-$it\n" })
        val index = LogLineIndex(path)
        val matching = CountDownLatch(1)
        val release = CountDownLatch(1)
        val read = CountDownLatch(1)

        val searcher = thread {
            index.search(
                { line ->
                    matching.countDown()
                    release.await()
                    line.contains("line-4999")
                },
                0,
                0,
                true,
                30_000,
                0L,
            )
        }
        // ! Started only once the search is parked inside its matcher. Racing the two from the
        // ! start lets the read win on merit, and the test passes even while the monitor is held.
        assertTrue(matching.await(5, TimeUnit.SECONDS), "search never reached the matcher")
        val reader = thread {
            if (index.readJson(0, 1, 1L shl 20, 0, 0L) != null) read.countDown()
        }

        try {
            assertTrue(read.await(5, TimeUnit.SECONDS), "read blocked behind the running search")
        } finally {
            release.countDown()
            searcher.join(5_000)
            reader.join(5_000)
        }
    }

    @Test
    fun `a search abandons a pattern that reaches neither deadline`() {
        // ! The whole-search budget must outlive the first deadline check, or the search aborts
        // ! before it ever calls the matcher and the watchdog is never exercised.
        manager.searchBudgetMillis = 50
        manager.searchGraceMillis = 200
        // ? `repetitionCost` refuses this pattern outright now, which is the point of that guard.
        // ? The watchdog behind it still has to work for anything the scan lets through.
        manager.maxRepetitionProduct = Long.MAX_VALUE
        writeLog("server.log", "alpha\n")

        // ? Consumes no input, so `DeadlineInput.get` never runs and neither bound can fire. The
        // ? repetition counts keep the abandoned thread finite rather than spinning for the JVM.
        val started = System.nanoTime()
        assertEquals(-3, searchLine("server.log", "(?:(?:){60000}){60000}", 0, true, true, false, 0))
        assertTrue((System.nanoTime() - started) / 1_000_000 < 5_000, "watchdog did not fire")
    }

    @Test
    fun `abandoned searches do not use up the capacity of later ones`() {
        manager.searchBudgetMillis = 50
        manager.searchGraceMillis = 200
        manager.maxRepetitionProduct = Long.MAX_VALUE
        writeLog("server.log", "alpha\nbeta\n")

        // ? Each of these strands its worker: the pattern consumes no input, so nothing can stop
        // ? the match and the thread never comes back. Search has to survive that.
        val callers = (0 until 5).map {
            thread { searchLine("server.log", "(?:(?:){30000}){30000}", 0, true, true, false, 0) }
        }
        callers.forEach { it.join(5_000) }

        assertEquals(1, searchLine("server.log", "beta", 0, true, false, false, 0))
    }

    @Test
    fun `a scan pool stops replacing stranded threads at its ceiling`() {
        assertEquals(4, poolCeiling(4, 0, 20))
        assertEquals(9, poolCeiling(4, 5, 20))
        assertEquals(20, poolCeiling(4, 16, 20))
        assertEquals(20, poolCeiling(4, 100, 20))

        // ? The count pool is smaller and has its own ceiling; it must not borrow the search
        // ? pool's numbers, which is what crediting a stranded count to `searchExecutor` did.
        assertEquals(2, poolCeiling(2, 0, 6))
        assertEquals(6, poolCeiling(2, 100, 6))
    }

    @Test
    fun `a file rebuilt under a running search reports a stale scan, not absence`() {
        val path = writeLog("server.log", (0 until 5000).joinToString("") { "line-$it\n" })
        val index = LogLineIndex(path)
        val firstBlock = CountDownLatch(1)
        val rebuilt = CountDownLatch(1)
        var result = 0L

        val searcher = thread {
            result = index.search(
                { line ->
                    firstBlock.countDown()
                    rebuilt.await()
                    line.contains("line-4999")
                },
                0,
                0,
                true,
                30_000,
                0L,
            )
        }

        assertTrue(firstBlock.await(5, TimeUnit.SECONDS))
        Files.writeString(path, "replaced\n")
        rebuilt.countDown()
        searcher.join(5_000)

        // ! Not -1: the scan never covered the rest of the range, so it cannot report the string
        // ! absent from a file nobody finished reading.
        assertEquals(-4, result)
    }

    @Test
    fun `search refuses a regex whose repetition counts multiply out of hand`() {
        writeLog("server.log", "alpha\n")

        // ? Every one of these matches the empty string over and over, so it reads no character
        // ? and no deadline can reach it. Measured at 0.5-23 s before this guard existed.
        val runaway = listOf(
            "(?:(?:){20000}){20000}",
            "(?:(?:){20000}){20000,}",
            "(?:(?:){20000}?){20000}?",
            "(?:(?:){20000}+){20000}+",
            "(?:(?:(?:){1000}){1000}){1000}",
            // ! A zero count must not zero the product and let the rest through.
            "a{0}(?:(?:){20000}){20000}",
            // ! Disguises that hide the counts from a scan while Java still runs them. All but
            // ! the last work by making extended mode read the text differently than it looks.
            "(?x) # comment [ unbalanced\n(?:(?:){20000}){20000}",
            "(?x)(?:(?:){20 000}){20 000}",
            "(?x:(?:(?:) {20000}) {20000})",
            "(?x)(?:(?:){20# inner\n000}){20# outer\n000}",
            "(?x)# \\Q ignored\n(?:(?:){20000}){20000} # \\E",
            "(?x)(?:(?:){20000}) {20000,}",
            "(?x:(?:(?:){100000}) {100000,})",
            "(?:\\Q[\\E){0}(?:(?:){20000}){20000}",
        )

        for (query in runaway) {
            val error = assertFailsWith<IllegalArgumentException>(query) {
                searchLine("server.log", query, 0, true, true, false, 0)
            }
            assertTrue(
                error.message?.startsWith("Invalid regular expression") == true,
                "must reach the client as a validation error, not a 500: $query",
            )
        }
    }

    @Test
    fun `the repetition guard leaves ordinary patterns alone`() {
        writeLog("server.log", "10:00:00.000 ERROR c.e.x.Test - code 4021 at ff03a9b1\n")

        assertEquals(0, searchLine("server.log", "\\d{4}", 0, true, true, false, 0))
        assertEquals(0, searchLine("server.log", "[a-f0-9]{8}", 0, true, true, false, 0))
        assertEquals(0, searchLine("server.log", ".{1,200}", 0, true, true, false, 0))
        assertEquals(0, searchLine("server.log", "(?:\\w{2}){4}", 0, true, true, false, 0))

        // ? Several bounded spans in a row is what hunting through a stack trace looks like. Their
        // ? counts are sequential, so they must not compound into a refusal.
        assertEquals(0, searchLine("server.log", "c\\..{0,1000}code.{0,1000}at.{0,1000}", 0, true, true, false, 0))

        // ? Braces that are not quantifiers: a literal inside a class and an escaped pair.
        assertEquals(-1, searchLine("server.log", "[{20000}]{4}", 0, true, true, false, 0))
        assertEquals(-1, searchLine("server.log", "\\{20000\\}", 0, true, true, false, 0))
    }

    @Test
    fun `repetition cost compounds nesting but not sequence`() {
        // ? Siblings add. Three spans of a thousand is three thousand steps, not a billion, and
        // ? refusing this shape would break an ordinary hunt through a stack trace.
        assertTrue(repetitionCost(".{0,1000}ERROR.{0,1000}Exception.{0,1000}at\\s.+") < 10_000)
        assertEquals(4, repetitionCost("\\d{4}"))
        assertEquals(8, repetitionCost("[a-f0-9]{8}"))
        assertEquals(200, repetitionCost(".{1,200}"))

        // ? Nesting multiplies, which is the shape that actually runs away.
        assertTrue(repetitionCost("(?:(?:){20000}){20000}") > 100_000_000)
        assertTrue(repetitionCost("(?:(?:(?:){1000}){1000}){1000}") > 100_000_000)

        // ? An open-ended quantifier still owes its lower bound before it may stop.
        assertTrue(repetitionCost("(?:(?:){20000}){20000,}") > 100_000_000)

        // ? A zero count cannot zero the product and wave the rest of the pattern through.
        assertTrue(repetitionCost("a{0}(?:(?:){20000}){20000}") > 100_000_000)

        // ? Whitespace inside a count is real under `(?x)`, where Java ignores it.
        assertTrue(repetitionCost("(?x)(?:(?:){20 000}){20 000}") > 100_000_000)

        assertEquals(Long.MAX_VALUE, repetitionCost("(?:(?:x{2000000000}){2000000000}){2000000000}"))
    }

    @Test
    fun `repetition cost reads braces that are not quantifiers as literals`() {
        // ? `\Q...\E` quotes its contents, a class holds text rather than syntax, and `\x{...}`
        // ? carries an argument. Counting any of them refuses a pattern that repeats nothing.
        assertEquals(1, repetitionCost("\\Qsome{99999}{99999}\\E"))
        assertEquals(1, repetitionCost("[{20000}]"))
        assertEquals(1, repetitionCost("[]{1000001}]"))
        assertEquals(2, repetitionCost("\\x{100000}\\x{100000}"))
        assertEquals(7, repetitionCost("\\{20000\\}"))
        assertEquals(3, repetitionCost("\\p{Alpha}{3}"))
    }

    @Test
    fun `extended mode is refused because its text does not mean what it looks like`() {
        writeLog("server.log", "alpha\n")

        for (query in listOf("(?x)alpha", "(?x:alpha)", "(?ix)alpha", "(?x-i)alpha")) {
            val error = assertFailsWith<IllegalArgumentException>(query) {
                searchLine("server.log", query, 0, true, true, false, 0)
            }
            assertTrue(error.message?.contains("extended mode") == true, query)
        }

        // ? Turning it back off is not turning it on, and a plain group is not a flag group.
        assertEquals(0, searchLine("server.log", "(?i-x)alpha", 0, true, true, false, 0))
        assertEquals(0, searchLine("server.log", "(?:alpha)", 0, true, true, false, 0))
        assertEquals(0, searchLine("server.log", "(?i)ALPHA", 0, true, true, false, 0))
    }

    @Test
    fun `repetition cost refuses a pattern it cannot follow rather than guessing`() {
        // ! A `[` Java never treats as a class — inside a `(?x)` comment — would otherwise leave
        // ! the scan stuck inside a class and blind to every quantifier after it.
        assertEquals(
            Long.MAX_VALUE,
            repetitionCost("(?x) # comment [ unbalanced\n(?:(?:){20000}){20000}"),
        )
        assertEquals(Long.MAX_VALUE, repetitionCost("a{2})"))
        assertEquals(Long.MAX_VALUE, repetitionCost("(?:a{2}"))
    }

    @Test
    fun `a filtered search skips a hit the mask hides`() {
        writeLog(
            "server.log",
            entry("INFO", "boom in progress") +
                entry("ERROR", "boom") +
                entry("DEBUG", "boom again"),
        )
        val errors = mask(LEVEL_ERROR)

        assertEquals(1, searchLine("server.log", "boom", 0, true, false, false, errors))
        assertEquals(-1, searchLine("server.log", "boom", 2, true, false, false, errors))
        assertEquals(1, searchLine("server.log", "boom", 2, false, false, false, errors))
    }

    @Test
    fun `a filtered search matches the frames of an admitted entry`() {
        writeLog(
            "server.log",
            entry("ERROR", "boom") +
                "java.lang.NullPointerException: nope\n" +
                entry("INFO", "nope"),
        )
        val errors = mask(LEVEL_ERROR)

        // ? The frame inherits ERROR from the entry above it, so it is part of the filtered view.
        assertEquals(1, searchLine("server.log", "nope", 0, true, false, false, errors))
        assertEquals(-1, searchLine("server.log", "nope", 2, true, false, false, errors))
        assertEquals(2, searchLine("server.log", "nope", 2, true, false, false, 0))
    }

    @Test
    fun `a filtered search reports absence when every hit is hidden`() {
        writeLog("server.log", entry("INFO", "alpha") + entry("DEBUG", "alpha"))

        assertEquals(-1, searchLine("server.log", "alpha", 0, true, false, false, mask(LEVEL_ERROR)))
        assertEquals(-1, searchLine("server.log", "alpha", 1, false, false, false, mask(LEVEL_ERROR)))
    }

    @Test
    fun `a mask admitting every level searches every line`() {
        writeLog("server.log", entry("INFO", "alpha") + entry("ERROR", "beta"))

        assertEquals(0, searchLine("server.log", "alpha", 0, true, false, false, LEVEL_MASK_ALL))
        assertEquals(1, searchLine("server.log", "beta", 0, true, false, false, LEVEL_MASK_ALL))
    }

    @Test
    fun `a filtered search spans several blocks`() {
        val log = (0 until 3000).joinToString("") { entry("INFO", "line-$it") + entry("ERROR", "line-$it") }
        writeLog("server.log", log)
        val errors = mask(LEVEL_ERROR)

        assertEquals(5999, searchLine("server.log", "line-2999", 0, true, false, false, errors))
        assertEquals(5001, searchLine("server.log", "line-2500", 6000, false, false, false, errors))
        assertEquals(-1, searchLine("server.log", "line-3000", 0, true, false, false, errors))
    }

    @Test
    fun `search returns the not-found marker for an unknown file`() {
        assertEquals(-2, searchLine("missing.log", "x", 0, true, false, false, 0))
        assertEquals(-2, searchLine("../server.log", "x", 0, true, false, false, 0))
    }

    //
    // * match count
    //

    @Test
    fun `matches counts every hit in the file and splits them by level`() {
        writeLog(
            "server.log",
            entry("INFO", "alpha one") +
                entry("ERROR", "alpha two") +
                "\tat alpha.Frame.run(Frame.java:1)\n" +
                entry("WARN", "beta"),
        )

        val json = countMatches("server.log", "alpha")

        assertEquals(3, number(json, "total"))
        // ? The stack frame belongs to the ERROR entry above it, so it counts as an error.
        assertEquals(listOf(0, 0, 0, 1, 0, 2), matchLevels(json))
        assertEquals(4, number(json, "lines"))
    }

    @Test
    fun `the count ignores the level mask entirely`() {
        writeLog("server.log", entry("INFO", "alpha") + entry("ERROR", "alpha"))

        // ! No mask parameter exists on `matches` at all: a filter is applied to the finished
        // ! counts, which is what keeps a level toggle from discarding a scan in progress.
        val json = countMatches("server.log", "alpha")

        assertEquals(2, number(json, "total"))
        assertEquals(listOf(0, 0, 0, 1, 0, 1), matchLevels(json))
    }

    @Test
    fun `a count reports its progress and finishes over several slices`() {
        val log = (0 until 6000).joinToString("") { entry("INFO", "line-$it") }
        writeLog("server.log", log)
        manager.matchSliceMillis = 0

        // ? A zero-length slice still folds the block it is holding, so the scan advances by one
        // ? block per call — which is exactly the loop the client runs.
        val first = assertNotNull(manager.matches("server.log", "line-", false, false, 0L))
        assertTrue(first.contains(""""complete":false"""), first)
        assertTrue(number(first, "scanned") > 0, first)
        assertTrue(number(first, "scanned") < 6000, first)

        manager.matchSliceMillis = 750
        val done = countMatches("server.log", "line-")

        assertTrue(done.contains(""""complete":true"""), done)
        assertEquals(6000, number(done, "total"))
        assertEquals(6000, number(done, "scanned"))
    }

    @Test
    fun `a count resumes where the previous slice stopped`() {
        val log = (0 until 6000).joinToString("") { entry("INFO", "line-$it") }
        writeLog("server.log", log)
        manager.matchSliceMillis = 0

        val first = assertNotNull(manager.matches("server.log", "line-", false, false, 0L))
        val second = assertNotNull(manager.matches("server.log", "line-", false, false, 0L))

        assertTrue(number(second, "scanned") > number(first, "scanned"), second)
        assertTrue(number(second, "total") > number(first, "total"), second)
    }

    @Test
    fun `two queries on one file each keep their own count`() {
        writeLog("server.log", entry("INFO", "alpha") + entry("ERROR", "beta"))

        assertEquals(1, number(countMatches("server.log", "alpha"), "total"))
        assertEquals(1, number(countMatches("server.log", "beta"), "total"))
        assertEquals(1, number(countMatches("server.log", "alpha"), "total"))
    }

    @Test
    fun `a second query does not evict a count still in progress`() {
        val log = (0 until 6000).joinToString("") { entry("INFO", "alpha-$it") + entry("ERROR", "beta-$it") }
        writeLog("server.log", log)
        manager.matchSliceMillis = 0

        // ? One slice each, interleaved — the shape two readers counting the same file produce.
        val alphaFirst = assertNotNull(manager.matches("server.log", "alpha-", false, false, 0L))
        manager.matches("server.log", "beta-", false, false, 0L)
        val alphaSecond = assertNotNull(manager.matches("server.log", "alpha-", false, false, 0L))

        // ! Resumed, not restarted: an MRU of one would have reset this to the first block again,
        // ! and neither reader would ever reach a complete count.
        assertTrue(
            number(alphaSecond, "scanned") > number(alphaFirst, "scanned"),
            "$alphaFirst then $alphaSecond",
        )
    }

    @Test
    fun `an unfinished scan never walks backwards`() {
        val log = (0 until 8000).joinToString("") { entry("INFO", "alpha-$it") }
        writeLog("server.log", log)
        manager.matchSliceMillis = 0

        // ? More queries than the file will count at once, polled round-robin — the shape that
        // ? made every scan evict the one polled before it.
        val queries = (1..MAX_MATCH_SCANS + 2).map { "alpha-$it" }
        val furthest = mutableMapOf<String, Long>()
        val finished = mutableSetOf<String>()

        repeat(12) {
            for (query in queries) {
                if (query in finished) continue

                val json = manager.matches("server.log", query, false, false, 0L) ?: continue
                if (!json.contains(""""status":"ok"""")) continue

                val scanned = number(json, "scanned")
                // ! Monotonic while the scan is unfinished. One walking backwards is being
                // ! recreated from line 0 every round, and never reaches a total at all.
                assertTrue(
                    scanned >= (furthest[query] ?: 0L),
                    "$query went backwards: ${furthest[query]} then $scanned",
                )
                furthest[query] = scanned

                // ? A finished scan may be evicted to make room, which legitimately restarts it.
                if (json.contains(""""complete":true""")) finished += query
            }
        }

        assertTrue(finished.isNotEmpty(), "no query ever reached a complete count")
    }

    @Test
    fun `a file counting all it can refuses another query rather than evicting one`() {
        val log = (0 until 8000).joinToString("") { entry("INFO", "alpha-$it") }
        writeLog("server.log", log)
        manager.matchSliceMillis = 0

        // ? One slice each, so none of them finishes and none can be evicted.
        for (index in 0 until MAX_MATCH_SCANS) {
            val json = assertNotNull(manager.matches("server.log", "alpha-$index", false, false, 0L))
            assertTrue(json.contains(""""status":"ok""""), json)
        }

        val refused = assertNotNull(manager.matches("server.log", "alpha-overflow", false, false, 0L))
        assertTrue(refused.contains(""""status":"busy""""), refused)

        // ! The refusal must not have cost an existing scan its place.
        manager.matchSliceMillis = 750
        assertEquals(1, number(countMatches("server.log", "alpha-0"), "total"))
    }

    @Test
    fun `interleaved counts never fold one query's matches into another`() {
        writeLog("server.log", entry("INFO", "alpha") + entry("ERROR", "beta"))
        manager.matchSliceMillis = 0

        repeat(4) {
            manager.matches("server.log", "alpha", false, false, 0L)
            manager.matches("server.log", "beta", false, false, 0L)
        }

        val alpha = countMatches("server.log", "alpha")
        val beta = countMatches("server.log", "beta")

        assertEquals(1, number(alpha, "total"))
        assertEquals(listOf(0, 0, 0, 1, 0, 0), matchLevels(alpha))
        assertEquals(1, number(beta, "total"))
        assertEquals(listOf(0, 0, 0, 0, 0, 1), matchLevels(beta))
    }

    @Test
    fun `concurrent counts of different queries both complete`() {
        val log = (0 until 4000).joinToString("") { entry("INFO", "alpha-$it") + entry("ERROR", "beta-$it") }
        writeLog("server.log", log)

        val results = java.util.concurrent.ConcurrentHashMap<String, String>()
        val threads = listOf("alpha-", "beta-").map { query ->
            thread { results[query] = countMatches("server.log", query) }
        }
        threads.forEach { it.join(30_000) }

        for (query in listOf("alpha-", "beta-")) {
            val json = assertNotNull(results[query], "$query never finished")
            assertTrue(json.contains(""""complete":true"""), "$query: $json")
            assertEquals(4000, number(json, "total"), "$query: $json")
        }
    }

    @Test
    fun `case sensitivity and regex are part of the count's identity`() {
        writeLog("server.log", entry("INFO", "Alpha") + entry("ERROR", "alpha"))

        assertEquals(2, number(countMatches("server.log", "alpha"), "total"))
        assertEquals(1, number(countMatches("server.log", "alpha", caseSensitive = true), "total"))
        assertEquals(2, number(countMatches("server.log", "al.ha", regex = true), "total"))
    }

    @Test
    fun `a count leaves out the trailing line until the file terminates it`() {
        writeLog("server.log", entry("INFO", "alpha one"))
        append(logsDir.resolve("server.log"), "08:00:00.000 INFO  c.e.x.Test - alpha two")

        // ! The half-written line is excluded, not counted: the bytes still to come can change
        // ! what it matches, and a folded entry has to be final.
        val partial = countMatches("server.log", "alpha")
        assertEquals(1, number(partial, "total"))
        assertEquals(2, number(partial, "lines"))
        assertEquals(1, number(partial, "scanned"))

        append(logsDir.resolve("server.log"), "\n")

        assertEquals(2, number(countMatches("server.log", "alpha"), "total"))
    }

    @Test
    fun `a count picks up lines appended after it finished`() {
        writeLog("server.log", entry("INFO", "alpha one"))
        assertEquals(1, number(countMatches("server.log", "alpha"), "total"))

        append(logsDir.resolve("server.log"), entry("ERROR", "alpha two"))

        val json = countMatches("server.log", "alpha")
        assertEquals(2, number(json, "total"))
        assertEquals(listOf(0, 0, 0, 1, 0, 1), matchLevels(json))
    }

    @Test
    fun `a count is rebuilt when the file is truncated`() {
        writeLog("server.log", entry("INFO", "alpha") + entry("ERROR", "alpha"))
        assertEquals(2, number(countMatches("server.log", "alpha"), "total"))

        writeLog("server.log", entry("WARN", "alpha"))

        val json = countMatches("server.log", "alpha")
        assertEquals(1, number(json, "total"))
        assertEquals(listOf(0, 0, 0, 0, 1, 0), matchLevels(json))
    }

    @Test
    fun `matches returns null for an unknown file`() {
        assertNull(manager.matches("missing.log", "x", false, false, 0L))
        assertNull(manager.matches("../server.log", "x", false, false, 0L))
    }

    @Test
    fun `matches rejects an empty query and an invalid regex`() {
        writeLog("server.log", entry("INFO", "alpha"))

        assertFailsWith<IllegalArgumentException> { manager.matches("server.log", "", false, false, 0L) }
        assertFailsWith<IllegalArgumentException> { manager.matches("server.log", null, false, false, 0L) }
        assertFailsWith<IllegalArgumentException> {
            manager.matches("server.log", "[unclosed", true, false, 0L)
        }
    }

    //
    // * match ordinal
    //

    @Test
    fun `search reports the position of the hit among all the matches`() {
        writeLog(
            "server.log",
            entry("INFO", "alpha") + entry("ERROR", "alpha") + entry("WARN", "alpha"),
        )
        countMatches("server.log", "alpha")

        assertEquals(0, ordinalOf("server.log", "alpha", 0, 0))
        assertEquals(1, ordinalOf("server.log", "alpha", 1, 0))
        assertEquals(2, ordinalOf("server.log", "alpha", 2, 0))
    }

    @Test
    fun `the ordinal counts only the matches the mask admits`() {
        writeLog(
            "server.log",
            entry("INFO", "alpha") + entry("ERROR", "alpha") + entry("ERROR", "alpha"),
        )
        countMatches("server.log", "alpha")
        val errors = mask(LEVEL_ERROR)

        // ? The INFO hit above them is not in this view, so the first error is the first match.
        assertEquals(0, ordinalOf("server.log", "alpha", 1, errors))
        assertEquals(1, ordinalOf("server.log", "alpha", 2, errors))
    }

    @Test
    fun `a backward search past the end of the file finds the last match`() {
        writeLog("server.log", entry("INFO", "alpha") + entry("ERROR", "beta") + entry("WARN", "alpha"))
        countMatches("server.log", "alpha")

        // ! `Int.MAX_VALUE` used to overflow the indexed path's `from + 1` into `Int.MIN_VALUE`,
        // ! so the same request answered differently once the count completed.
        assertEquals(2, searchLine("server.log", "alpha", Int.MAX_VALUE.toLong(), false, false, false, 0))
        assertEquals(2, searchLine("server.log", "alpha", Long.MAX_VALUE, false, false, false, 0))
    }

    @Test
    fun `a search reports no ordinal until the count has reached the hit`() {
        val log = (0 until 6000).joinToString("") { entry("INFO", "line-$it") }
        writeLog("server.log", log)

        // ? Nothing has counted anything yet, so the hit has no position to report.
        val json = assertNotNull(manager.search("server.log", "line-5999", 0, true, false, false, 0, 0L))
        assertEquals(5999, number(json, "line"))
        assertTrue(json.contains(""""ordinal":null"""), json)
    }

    @Test
    fun `a search with no hit reports neither a line nor an ordinal`() {
        writeLog("server.log", entry("INFO", "alpha"))
        countMatches("server.log", "alpha")

        val json = assertNotNull(manager.search("server.log", "alpha", 1, true, false, false, 0, 0L))

        assertTrue(json.contains(""""line":null"""), json)
        assertTrue(json.contains(""""ordinal":null"""), json)
    }

    @Test
    fun `a completed count answers navigation without rescanning the file`() {
        writeLog(
            "server.log",
            entry("INFO", "alpha") + entry("ERROR", "beta") + entry("WARN", "alpha"),
        )
        countMatches("server.log", "alpha")

        // ! Served from the index rather than the scan, so the whole-search budget cannot apply.
        manager.searchBudgetMillis = 0

        assertEquals(0, searchLine("server.log", "alpha", 0, true, false, false, 0))
        assertEquals(2, searchLine("server.log", "alpha", 1, true, false, false, 0))
        assertEquals(0, searchLine("server.log", "alpha", 1, false, false, false, 0))
        assertEquals(-1, searchLine("server.log", "alpha", 3, true, false, false, 0))
    }

    @Test
    fun `the indexed path still honours the level mask`() {
        writeLog(
            "server.log",
            entry("INFO", "alpha") + entry("ERROR", "alpha") + entry("WARN", "alpha"),
        )
        countMatches("server.log", "alpha")
        manager.searchBudgetMillis = 0

        assertEquals(1, searchLine("server.log", "alpha", 0, true, false, false, mask(LEVEL_ERROR)))
        assertEquals(2, searchLine("server.log", "alpha", 0, true, false, false, mask(LEVEL_WARN)))
        assertEquals(-1, searchLine("server.log", "alpha", 0, true, false, false, mask(LEVEL_DEBUG)))
    }

    @Test
    fun `an appended line puts navigation back on the scanning path`() {
        writeLog("server.log", entry("INFO", "alpha"))
        countMatches("server.log", "alpha")
        append(logsDir.resolve("server.log"), entry("ERROR", "alpha"))

        // ? The index no longer covers the file, so the search scans — and finds the new line
        // ? rather than reporting the stale count's last word on it.
        assertEquals(1, searchLine("server.log", "alpha", 1, true, false, false, 0))
    }

    //
    // * name validation
    //

    @Test
    fun `rejected names never resolve`() {
        writeLog("server.log", "one\n")
        Files.createDirectories(logsDir.resolve("dir"))
        writeLog("dir/a.log", "one\n")
        writeLog(".hidden.log", "one\n")
        writeLog("notes.txt", "one\n")
        Files.write(logsDir.parent.resolve("outside.log"), "one\n".toByteArray())

        for (name in listOf(
            "../outside.log",
            "../server.log",
            "dir/a.log",
            "/etc/passwd",
            ".hidden.log",
            "notes.txt",
            ".",
            "",
        )) {
            assertNull(manager.info(name, 0, 0L), "info accepted '$name'")
            assertNull(manager.read(name, 0, 10, 0, 0L), "read accepted '$name'")
            assertNull(manager.download(name, 0L), "download accepted '$name'")
        }

        assertNull(manager.info(null, 0, 0L))
        assertNull(manager.read(null, 0, 10, 0, 0L))
        assertNull(manager.download(null, 0L))
    }

    //
    // * download
    //

    @Test
    fun `download exposes the raw file bytes`() {
        writeLog("server.log", "one\ntwo\n")

        val source = assertNotNull(manager.download("server.log", 0L))
        assertEquals("one\ntwo\n", String(source.read(), Charsets.UTF_8))
        assertNull(manager.download("missing.log", 0L))
    }

    @Test
    fun `download serves only the window when one is in effect`() {
        writeLog(
            "server.log",
            at("08:00:00.000", "INFO", "first") +
                at("09:00:00.000", "INFO", "second") +
                at("09:30:00.000", "INFO", "third"),
        )

        val source = assertNotNull(manager.download("server.log", 1L))
        assertEquals(
            at("09:00:00.000", "INFO", "second") + at("09:30:00.000", "INFO", "third"),
            String(source.read(), Charsets.UTF_8),
        )
    }

    @Test
    fun `download ignores a start past the end of the file`() {
        writeLog("server.log", at("08:00:00.000", "INFO", "only"))

        val source = assertNotNull(manager.download("server.log", 99L))
        assertEquals("", String(source.read(), Charsets.UTF_8))
    }

    //
    // * window
    //

    @Test
    fun `timeText renders every digit of a millisecond-of-day`() {
        assertEquals("00:00:00.000", timeText(0))
        assertEquals("12:34:56.789", timeText(45_296_789))
        assertEquals("23:59:59.999", timeText(86_399_999))
        assertEquals("09:08:07.006", timeText(32_887_006))
    }

    @Test
    fun `window clamps a nonsense span rather than refusing it`() {
        writeLog("server.log", fourEntries())

        // ? The API rejects these before the bean sees them, but the bean is a public XP surface
        // ? of its own and a caller reaching it directly must not get an arbitrary cut.
        assertEquals(manager.window("server.log", 1), manager.window("server.log", 0))
        assertEquals(manager.window("server.log", 1), manager.window("server.log", -50))
        assertEquals(WHOLE_FILE, manager.window("server.log", 10_000_000))
    }

    @Test
    fun `window reaches past a stack trace longer than any lookback`() {
        // ? Shaped so the first probe of the binary search lands deep inside the trace, thousands
        // ? of lines below the entry that owns it — which is the only place a bounded walk back
        // ? differs from an unbounded one.
        val older = (0..99).joinToString("") { at("08:0${it / 60}:${(it % 60).toString().padStart(2, '0')}.000", "INFO", "old-$it") }
        val frames = (1..9000).joinToString("") { "\tat com.example.Deep.run(Deep.java:$it)\n" }
        writeLog(
            "server.log",
            older + at("09:00:00.000", "ERROR", "boom") + frames + at("09:10:00.000", "INFO", "after"),
        )

        // ! The ERROR opens the window, so the cut lands on it. A walk that gave up partway reads
        // ! its frames as older than the cutoff and reports the entry *below* the whole trace,
        // ! dropping the error the reader opened the window to see.
        assertEquals("""{"line":100,"time":"09:00:00.000"}""", manager.window("server.log", 30))
    }

    @Test
    fun `window cuts nothing on a file whose times do not ascend`() {
        // ? Written across midnight: the closing entry is earlier in the day than the opening
        // ? one, so nothing in the file orders the two halves and a binary search is meaningless.
        writeLog(
            "server.log",
            at("22:00:00.000", "INFO", "yesterday") +
                at("22:30:00.000", "INFO", "yesterday still") +
                at("00:10:00.000", "INFO", "today") +
                at("01:15:00.000", "INFO", "today later"),
        )

        assertEquals(WHOLE_FILE, manager.window("server.log", 15))
    }

    @Test
    fun `window cuts at the first entry inside the span, measured from the last entry`() {
        writeLog(
            "server.log",
            at("08:00:00.000", "INFO", "a") +
                at("08:10:00.000", "INFO", "b") +
                at("08:30:00.000", "INFO", "c") +
                at("09:00:00.000", "INFO", "d"),
        )

        assertEquals(
            """{"line":2,"time":"08:30:00.000"}""",
            manager.window("server.log", 35),
        )
    }

    @Test
    fun `window cuts on an entry head, never into the stack trace under it`() {
        writeLog(
            "server.log",
            at("08:00:00.000", "ERROR", "old") +
                "\tat com.example.Old.run(Old.java:1)\n" +
                "\tat com.example.Old.go(Old.java:2)\n" +
                at("09:00:00.000", "ERROR", "new") +
                "\tat com.example.New.run(New.java:1)\n" +
                "\tat com.example.New.go(New.java:2)\n",
        )

        // ? The anchor is the trailing frame, which inherits 09:00 from the entry it continues.
        assertEquals(
            """{"line":3,"time":"09:00:00.000"}""",
            manager.window("server.log", 30),
        )
    }

    @Test
    fun `window cuts nothing when the span covers the whole file`() {
        writeLog(
            "server.log",
            at("08:00:00.000", "INFO", "a") + at("08:10:00.000", "INFO", "b"),
        )

        assertEquals(WHOLE_FILE, manager.window("server.log", 600))
    }

    @Test
    fun `window cuts nothing when it would reach back past midnight`() {
        writeLog(
            "server.log",
            at("00:10:00.000", "INFO", "a") + at("00:20:00.000", "INFO", "b"),
        )

        assertEquals(WHOLE_FILE, manager.window("server.log", 60))
    }

    @Test
    fun `info classifies the dated pattern XP writes server log with`() {
        // ! `server.log` carries Logback's dated default, `yyyy-MM-dd HH:mm:ss,SSS`. Reading only
        // ! the time-only pattern leaves every line unknown, which empties the view the moment a
        // ! level is selected and makes a windowed or filtered search find nothing.
        writeLog(
            "server.log",
            at("2026-08-31 00:00:09,261", "WARN", "url build failed") +
                "com.enonic.xp.portal.impl.exception.OutOfScopeException: URI out of scope\n" +
                "\tat com.enonic.xp.portal.impl.url.UrlBuilderHelper.rewriteUri(Helper.java:160)\n" +
                at("2026-08-31 00:01:00,000", "INFO", "recovered"),
        )

        val json = assertNotNull(manager.info("server.log", 0, 0L))

        assertEquals(4, number(json, "lines"))
        assertEquals(3, number(json, "warn"))
        assertEquals(1, number(json, "info"))
        assertEquals(0, number(json, "unknown"))
    }

    @Test
    fun `info classifies a dot separator on the dated pattern too`() {
        writeLog("server.log", at("2026-08-31 08:00:00.000", "ERROR", "boom"))

        assertEquals(1, number(assertNotNull(manager.info("server.log", 0, 0L)), "error"))
    }

    @Test
    fun `info reads a comma separator on the time-only pattern too`() {
        writeLog("server.log", "08:00:00,000 ERROR c.e.x.Test - boom\n")

        assertEquals(1, number(assertNotNull(manager.info("server.log", 0, 0L)), "error"))
    }

    @Test
    fun `info leaves a line carrying an impossible date unclassified`() {
        // ? Range-checking the date is what lets the epoch-day conversion be total.
        writeLog("server.log", at("2026-13-31 08:00:00,000", "ERROR", "boom"))

        val json = assertNotNull(manager.info("server.log", 0, 0L))

        assertEquals(0, number(json, "error"))
        assertEquals(1, number(json, "unknown"))
    }

    @Test
    fun `window cuts across midnight on a dated file`() {
        // ! The undated pattern has to give up here — its times fall rather than rise. A dated
        // ! one orders the two halves, so the window it asks for is the window it gets.
        writeLog(
            "server.log",
            at("2026-08-30 22:00:00,000", "INFO", "yesterday") +
                at("2026-08-30 23:30:00,000", "INFO", "yesterday still") +
                at("2026-08-31 00:10:00,000", "INFO", "today") +
                at("2026-08-31 00:15:00,000", "INFO", "today later"),
        )

        assertEquals(
            """{"line":2,"time":"2026-08-31 00:10:00.000"}""",
            manager.window("server.log", 30),
        )
    }

    @Test
    fun `window cuts nothing when a dated span covers the whole file`() {
        writeLog(
            "server.log",
            at("2026-08-31 08:00:00,000", "INFO", "a") +
                at("2026-08-31 08:10:00,000", "INFO", "b"),
        )

        assertEquals(WHOLE_FILE, manager.window("server.log", 600))
    }

    @Test
    fun `window cuts nothing when the file declares no entry to anchor to`() {
        writeLog("server.log", "plain text\nmore plain text\n")

        assertEquals(WHOLE_FILE, manager.window("server.log", 30))
    }

    @Test
    fun `window reports nothing for an empty or missing file`() {
        writeLog("server.log", "")

        assertEquals(WHOLE_FILE, manager.window("server.log", 30))
        assertNull(manager.window("missing.log", 30))
    }

    @Test
    fun `read serves the window and numbers its lines physically`() {
        writeLog("server.log", fourEntries())

        val json = assertNotNull(manager.read("server.log", 0, 100, 0, 2L))

        assertEquals(listOf("c", "d"), parseLines(json).map { it.substringAfterLast("- ") })
        assertEquals(listOf(2, 3), parseNumbers(json))
        assertEquals(2, number(json, "total"))
    }

    @Test
    fun `read pages inside the window rather than from the start of the file`() {
        writeLog("server.log", fourEntries())

        val json = assertNotNull(manager.read("server.log", 1, 100, 0, 2L))

        assertEquals(listOf("d"), parseLines(json).map { it.substringAfterLast("- ") })
        assertEquals(listOf(3), parseNumbers(json))
    }

    @Test
    fun `read emits no numbers when nothing narrows the view`() {
        writeLog("server.log", fourEntries())

        assertEquals(emptyList(), parseNumbers(assertNotNull(manager.read("server.log", 0, 100, 0, 0L))))
    }

    @Test
    fun `info counts the lines the window leaves`() {
        writeLog("server.log", fourEntries())

        val json = assertNotNull(manager.info("server.log", 0, 2L))

        assertEquals(4, number(json, "lines"))
        assertEquals(2, number(json, "filtered"))
    }

    @Test
    fun `window and level filter narrow the same view together`() {
        writeLog(
            "server.log",
            at("08:00:00.000", "INFO", "a") +
                at("08:10:00.000", "ERROR", "b") +
                at("08:20:00.000", "INFO", "c") +
                at("08:30:00.000", "ERROR", "d"),
        )
        val errors = mask(LEVEL_ERROR)

        assertEquals(2, number(assertNotNull(manager.info("server.log", errors, 0L)), "filtered"))

        val json = assertNotNull(manager.read("server.log", 0, 100, errors, 2L))
        assertEquals(listOf(3), parseNumbers(json))
        assertEquals(1, number(json, "total"))
        assertEquals(1, number(assertNotNull(manager.info("server.log", errors, 2L)), "filtered"))
    }

    @Test
    fun `locate rebases a line onto the window and reports one above it as hidden`() {
        writeLog("server.log", fourEntries())

        assertEquals("""{"position":1,"visible":true}""", manager.locate("server.log", 0, 3, 2L))
        assertEquals("""{"position":0,"visible":true}""", manager.locate("server.log", 0, 2, 2L))
        assertEquals("""{"position":0,"visible":false}""", manager.locate("server.log", 0, 0, 2L))
    }

    @Test
    fun `locate rebases onto a window and a level filter at once`() {
        writeLog(
            "server.log",
            at("08:00:00.000", "ERROR", "a") +
                at("08:10:00.000", "INFO", "b") +
                at("08:20:00.000", "ERROR", "c") +
                at("08:30:00.000", "ERROR", "d"),
        )
        val errors = mask(LEVEL_ERROR)

        assertEquals("""{"position":0,"visible":true}""", manager.locate("server.log", errors, 2, 2L))
        assertEquals("""{"position":1,"visible":true}""", manager.locate("server.log", errors, 3, 2L))
        // ? Line 0 is an ERROR the mask admits, so only the window is keeping it off screen.
        assertEquals("""{"position":0,"visible":false}""", manager.locate("server.log", errors, 0, 2L))
    }

    @Test
    fun `search finds nothing above the window`() {
        writeLog(
            "server.log",
            at("08:00:00.000", "INFO", "needle") +
                at("08:10:00.000", "INFO", "b") +
                at("08:20:00.000", "INFO", "c"),
        )

        val json = assertNotNull(
            manager.search("server.log", "needle", 2, false, false, false, 0, 1L),
        )
        assertTrue(json.contains("\"line\":null"), json)

        val whole = assertNotNull(
            manager.search("server.log", "needle", 2, false, false, false, 0, 0L),
        )
        assertEquals(0, number(whole, "line"))
    }

    @Test
    fun `an indexed search finds nothing above the window either`() {
        writeLog(
            "server.log",
            at("08:00:00.000", "INFO", "needle") +
                at("08:10:00.000", "INFO", "b") +
                at("08:20:00.000", "INFO", "needle"),
        )
        completeCount("needle")

        val windowed = assertNotNull(
            manager.search("server.log", "needle", 2, false, false, false, 0, 1L),
        )
        assertEquals(2, number(windowed, "line"))

        val backward = assertNotNull(
            manager.search("server.log", "needle", 1, false, false, false, 0, 1L),
        )
        assertTrue(backward.contains("\"line\":null"), backward)
    }

    @Test
    fun `match counts report only the hits inside the window`() {
        writeLog(
            "server.log",
            at("08:00:00.000", "INFO", "needle") +
                at("08:10:00.000", "ERROR", "needle") +
                at("08:20:00.000", "ERROR", "needle"),
        )
        completeCount("needle")

        val whole = assertNotNull(manager.matches("server.log", "needle", false, false, 0L))
        assertEquals(3, number(whole, "total"))

        val windowed = assertNotNull(manager.matches("server.log", "needle", false, false, 2L))
        assertEquals(1, number(windowed, "total"))
        assertEquals(listOf(0, 0, 0, 0, 0, 1), parseLevelCounts(windowed))
        // ! The scan itself is never narrowed, so a client polling on these still converges.
        assertEquals(3, number(windowed, "scanned"))
        assertEquals(3, number(windowed, "lines"))
    }

    @Test
    fun `a match ordinal counts from the start of the window`() {
        writeLog(
            "server.log",
            at("08:00:00.000", "INFO", "needle") +
                at("08:10:00.000", "INFO", "needle") +
                at("08:20:00.000", "INFO", "needle"),
        )
        completeCount("needle")

        val whole = assertNotNull(
            manager.search("server.log", "needle", 2, true, false, false, 0, 0L),
        )
        assertEquals(2, number(whole, "ordinal"))

        val windowed = assertNotNull(
            manager.search("server.log", "needle", 2, true, false, false, 0, 1L),
        )
        assertEquals(1, number(windowed, "ordinal"))
    }

    @Test
    fun `a start past the end of the file leaves an empty view`() {
        writeLog("server.log", fourEntries())

        assertEquals(0, number(assertNotNull(manager.info("server.log", 0, 99L)), "filtered"))
        assertEquals(emptyList(), parseLines(assertNotNull(manager.read("server.log", 0, 100, 0, 99L))))
        assertEquals("""{"position":0,"visible":false}""", manager.locate("server.log", 0, 0, 99L))
    }

    //
    // * Helpers
    //

    private fun writeLog(name: String, content: String, modifiedMillis: Long? = null): Path {
        val file = logsDir.resolve(name)
        Files.write(file, content.toByteArray(Charsets.UTF_8))
        if (modifiedMillis != null) {
            Files.setLastModifiedTime(file, FileTime.fromMillis(modifiedMillis))
        }
        return file
    }

    private fun append(file: Path, content: String) {
        Files.write(file, content.toByteArray(Charsets.UTF_8), StandardOpenOption.APPEND)
    }

    private fun readLines(name: String, from: Long, count: Int): List<String> {
        val json = assertNotNull(manager.read(name, from, count, 0, 0L))
        return parseLines(json)
    }

    /** One log entry in XP's Logback layout, `%-5level` padding included. */
    private fun entry(level: String, message: String): String =
        "08:00:00.000 ${level.padEnd(5)} c.e.x.Test - $message\n"

    private fun at(time: String, level: String, message: String): String =
        "$time ${level.padEnd(5)} c.e.x.Test - $message\n"

    private fun fourEntries(): String =
        at("08:00:00.000", "INFO", "a") +
            at("08:10:00.000", "INFO", "b") +
            at("08:20:00.000", "INFO", "c") +
            at("08:30:00.000", "INFO", "d")

    /** Runs the count for [query] to completion, which is what puts searches on the indexed path. */
    private fun completeCount(query: String) {
        repeat(MAX_MATCH_SCANS * 8) {
            val json = assertNotNull(manager.matches("server.log", query, false, false, 0L))
            if (json.contains("\"complete\":true")) return
        }
        throw AssertionError("count for '$query' never completed")
    }

    private fun parseLevelCounts(json: String): List<Int> {
        val marker = "\"levels\":["
        val start = json.indexOf(marker) + marker.length
        return json.substring(start, json.indexOf(']', start)).split(',').map { it.toInt() }
    }

    private fun mask(vararg levels: Byte): Int =
        levels.fold(0) { acc, level -> acc or (1 shl level.toInt()) }

    private fun filteredNumbers(name: String, mask: Int): List<Int> =
        parseNumbers(assertNotNull(manager.read(name, 0, 100, mask, 0L)))

    private fun parseNumbers(json: String): List<Int> {
        val marker = "],\"numbers\":["
        val start = json.lastIndexOf(marker)
        if (start < 0) return emptyList()
        val body = json.substring(start + marker.length, json.lastIndexOf("],\"total\""))
        if (body.isEmpty()) return emptyList()
        return body.split(',').map { it.toInt() }
    }

    private fun activeNames(json: String): List<String> =
        Regex(""""name":"([^"]+)","size":\d+,"modified":"[^"]+","active":true""")
            .findAll(json).map { it.groupValues[1] }.toList()

    private fun rotatedNames(json: String): List<String> =
        Regex(""""name":"([^"]+)","size":\d+,"modified":"[^"]+","active":(?:true|false),"rotated":true""")
            .findAll(json).map { it.groupValues[1] }.toList()

    /**
     * The search verdict as the plain line-number code the bean used to return: the matched line,
     * [LOG_NO_MATCH], [LOG_NOT_FOUND], [LOG_SEARCH_ABORTED] or [LOG_SEARCH_STALE]. The count that
     * now travels with it has its own tests; these are about which line was found.
     */
    private fun searchLine(
        name: String?,
        query: String?,
        from: Long,
        forward: Boolean,
        regex: Boolean,
        caseSensitive: Boolean,
        mask: Int,
    ): Long {
        val json = manager.search(name, query, from, forward, regex, caseSensitive, mask, 0L)
            ?: return LOG_NOT_FOUND
        if (json.contains(""""status":"aborted"""")) return LOG_SEARCH_ABORTED
        if (json.contains(""""status":"stale"""")) return LOG_SEARCH_STALE
        return if (json.contains(""""line":null""")) LOG_NO_MATCH else number(json, "line")
    }

    /** The `ordinal` a search for [query] reports when it lands on [line]. */
    private fun ordinalOf(name: String, query: String, line: Long, mask: Int): Long {
        val json = assertNotNull(manager.search(name, query, line, true, false, false, mask, 0L))
        assertEquals(line, number(json, "line"))
        return number(json, "ordinal")
    }

    /** Runs the count to completion the way the client does — one call per slice until it says so. */
    private fun countMatches(
        name: String,
        query: String,
        regex: Boolean = false,
        caseSensitive: Boolean = false,
    ): String {
        var json = manager.matches(name, query, regex, caseSensitive, 0L).orEmpty()
        var guard = 0
        while (json.contains(""""complete":false""") && guard++ < 100) {
            json = manager.matches(name, query, regex, caseSensitive, 0L).orEmpty()
        }
        return json
    }

    /** The `levels` array of a count response, indexed by level code. */
    private fun matchLevels(json: String): List<Int> {
        val body = json.substringAfter(""""levels":[""").substringBefore(']')
        return body.split(',').map { it.trim().toInt() }
    }

    private fun number(json: String, key: String): Long =
        NUMBER_REGEX.findAll(json).first { it.groupValues[1] == key }.groupValues[2].toLong()

    private fun parseLines(json: String): List<String> {
        val start = json.indexOf("\"lines\":[") + "\"lines\":[".length
        // ? A filtered response puts `numbers` between the two, and neither marker can occur
        // ? inside a line: an escaped quote is `\\"`, never a bare one.
        val numbers = json.lastIndexOf("],\"numbers\":[")
        val end = if (numbers >= 0) numbers else json.lastIndexOf("],\"total\"")
        val body = json.substring(start, end)
        if (body.isEmpty()) return emptyList()

        val lines = mutableListOf<String>()
        val current = StringBuilder()
        var index = 0
        var inString = false

        while (index < body.length) {
            val ch = body[index]
            when {
                !inString && ch == '"' -> inString = true
                !inString -> Unit
                ch == '\\' -> {
                    index++
                    when (val escaped = body[index]) {
                        'n' -> current.append('\n')
                        'r' -> current.append('\r')
                        't' -> current.append('\t')
                        'u' -> {
                            current.append(body.substring(index + 1, index + 5).toInt(16).toChar())
                            index += 4
                        }
                        else -> current.append(escaped)
                    }
                }
                ch == '"' -> {
                    lines += current.toString()
                    current.setLength(0)
                    inString = false
                }
                else -> current.append(ch)
            }
            index++
        }

        return lines
    }
}
