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

        val json = assertNotNull(manager.info("server.log", 0))

        assertEquals(3, number(json, "lines"))
        assertEquals(14, number(json, "size"))
        assertTrue(json.startsWith("{\"name\":\"server.log\""))
    }

    @Test
    fun `info returns null for a missing file`() {
        assertNull(manager.info("server.log", 0))
    }

    @Test
    fun `empty file has zero lines and reads as an empty list`() {
        writeLog("server.log", "")

        assertEquals(0, number(assertNotNull(manager.info("server.log", 0)), "lines"))
        assertEquals(
            """{"from":0,"lines":[],"total":0,"size":0}""",
            manager.read("server.log", 0, 200, 0),
        )
    }

    @Test
    fun `a trailing line without a newline still counts`() {
        writeLog("server.log", "one\ntwo")

        assertEquals(2, number(assertNotNull(manager.info("server.log", 0)), "lines"))
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

        assertEquals(4, number(assertNotNull(manager.info("server.log", 0)), "lines"))
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
        assertEquals(99, number(assertNotNull(manager.read("server.log", 99, 10, 0)), "from"))
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

        val json = assertNotNull(manager.read("server.log", 0, 10, 0))

        assertTrue(json.toByteArray(Charsets.UTF_8).size <= 200)
        // ? A short page, not an empty one: the client needs something to resume from.
        assertTrue(parseLines(json).size in 1..9)
        assertEquals(10, number(json, "total"))
    }

    @Test
    fun `read returns an empty page when the first line alone exceeds the byte cap`() {
        manager.maxReadBytes = 10
        writeLog("server.log", "x".repeat(50) + "\nshort\n")

        val json = assertNotNull(manager.read("server.log", 0, 10, 0))

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
        val capped = assertNotNull(manager.read("server.log", 0, 10, 0))
        assertEquals(emptyList(), parseLines(capped))
        assertTrue(capped.toByteArray(Charsets.UTF_8).size <= 1000)

        manager.maxReadBytes = 2000
        assertEquals(1, parseLines(assertNotNull(manager.read("server.log", 0, 10, 0))).size)
    }

    @Test
    fun `read reports the current total and size`() {
        writeLog("server.log", "one\ntwo\n")

        val json = assertNotNull(manager.read("server.log", 0, 1, 0))
        assertEquals(2, number(json, "total"))
        assertEquals(8, number(json, "size"))
        assertEquals(0, number(json, "from"))
    }

    @Test
    fun `read escapes control characters in line content`() {
        writeLog("server.log", "a\"b\\c\td\n")

        assertEquals("""{"from":0,"lines":["a\"b\\c\td"],"total":1,"size":8}""", manager.read("server.log", 0, 5, 0))
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

        val json = assertNotNull(manager.info("server.log", 0))

        assertEquals(5, number(json, "lines"))
        assertEquals(1, number(json, "info"))
        assertEquals(3, number(json, "error"))
        assertEquals(1, number(json, "warn"))
        assertEquals(0, number(json, "unknown"))
    }

    @Test
    fun `a continuation with no entry above it stays unknown`() {
        writeLog("server.log", "\tat com.enonic.Foo.bar(Foo.java:1)\n" + entry("INFO", "started"))

        val json = assertNotNull(manager.info("server.log", 0))

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

        val json = assertNotNull(manager.info("server.log", 0))

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

        val lines = parseLines(assertNotNull(manager.read("server.log", 0, 10, mask(LEVEL_ERROR))))

        assertEquals(1, lines.size)
        assertTrue(lines[0].endsWith("straddled"), lines[0])
    }

    @Test
    fun `a trailing line becomes an entry once the rest of its head arrives`() {
        val file = writeLog("server.log", entry("INFO", "first") + "08:00:01.000 ERROR c.e.x.Test")

        val partial = assertNotNull(manager.info("server.log", 0))
        assertEquals(0, number(partial, "error"))
        assertEquals(2, number(partial, "info"))

        append(file, " - boom\n")

        val whole = assertNotNull(manager.info("server.log", 0))
        assertEquals(1, number(whole, "error"))
        assertEquals(1, number(whole, "info"))
    }

    @Test
    fun `a mask admitting every level takes the unfiltered path`() {
        writeLog("server.log", entry("INFO", "a") + entry("ERROR", "b"))

        val json = assertNotNull(manager.read("server.log", 0, 10, LEVEL_MASK_ALL))

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

        val json = assertNotNull(manager.read("server.log", 0, 10, mask(LEVEL_ERROR)))
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

        val json = assertNotNull(manager.read("server.log", 1, 2, mask(LEVEL_ERROR)))

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
        val json = assertNotNull(manager.read("server.log", 0, 10, mask(LEVEL_ERROR)))
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
        assertEquals(2, number(assertNotNull(manager.info("server.log", 0)), "lines"))
    }

    @Test
    fun `a filtered view is rebuilt when the file is replaced`() {
        writeLog("server.log", entry("ERROR", "a") + entry("ERROR", "b"))
        val errors = mask(LEVEL_ERROR)

        assertEquals(2, number(assertNotNull(manager.read("server.log", 0, 10, errors)), "total"))

        writeLog("server.log", entry("INFO", "c"))

        assertEquals(0, number(assertNotNull(manager.read("server.log", 0, 10, errors)), "total"))
    }

    @Test
    fun `info reports the filtered count only while a filter is active`() {
        writeLog("server.log", entry("INFO", "a") + entry("ERROR", "b") + "\tat Foo.bar\n")

        val unfiltered = assertNotNull(manager.info("server.log", 0))
        assertFalse(unfiltered.contains("\"filtered\""), unfiltered)

        val filtered = assertNotNull(manager.info("server.log", mask(LEVEL_ERROR)))
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

        assertEquals("""{"position":0,"visible":true}""", manager.locate("server.log", errors, 1))
        assertEquals("""{"position":1,"visible":true}""", manager.locate("server.log", errors, 2))
        assertEquals("""{"position":2,"visible":true}""", manager.locate("server.log", errors, 3))
    }

    @Test
    fun `locate falls back to the entry above a hidden line`() {
        writeLog(
            "server.log",
            entry("INFO", "a") + entry("ERROR", "b") + entry("INFO", "c") + entry("INFO", "d"),
        )
        val errors = mask(LEVEL_ERROR)

        assertEquals("""{"position":0,"visible":false}""", manager.locate("server.log", errors, 2))
        assertEquals("""{"position":0,"visible":false}""", manager.locate("server.log", errors, 3))
        // ? Nothing visible above line 0, so the head of the view is the only answer.
        assertEquals("""{"position":0,"visible":false}""", manager.locate("server.log", errors, 0))
    }

    @Test
    fun `locate reports the head of an empty filtered view`() {
        writeLog("server.log", entry("INFO", "a"))

        assertEquals(
            """{"position":0,"visible":false}""",
            manager.locate("server.log", mask(LEVEL_ERROR), 4),
        )
    }

    @Test
    fun `locate clamps to the file when no filter is active`() {
        writeLog("server.log", entry("INFO", "a") + entry("ERROR", "b"))

        assertEquals("""{"position":1,"visible":true}""", manager.locate("server.log", 0, 1))
        assertEquals("""{"position":1,"visible":true}""", manager.locate("server.log", 0, 99))
        assertEquals("""{"position":0,"visible":true}""", manager.locate("server.log", 0, -5))
        assertNull(manager.locate("missing.log", 0, 0))
        assertNull(manager.locate(null, 0, 0))
    }

    //
    // * index maintenance
    //

    @Test
    fun `appending to an indexed file extends the index`() {
        val file = writeLog("server.log", "one\ntwo\n")
        assertEquals(2, number(assertNotNull(manager.info("server.log", 0)), "lines"))

        append(file, "three\nfour\n")

        assertEquals(4, number(assertNotNull(manager.info("server.log", 0)), "lines"))
        assertEquals(listOf("three", "four"), readLines("server.log", 2, 10))
    }

    @Test
    fun `appending to a partial last line completes it instead of adding one`() {
        val file = writeLog("server.log", "one\npar")
        assertEquals(2, number(assertNotNull(manager.info("server.log", 0)), "lines"))

        append(file, "tial\nthree\n")

        assertEquals(3, number(assertNotNull(manager.info("server.log", 0)), "lines"))
        assertEquals(listOf("one", "partial", "three"), readLines("server.log", 0, 10))
    }

    @Test
    fun `truncating a file rebuilds the index`() {
        val file = writeLog("server.log", "one\ntwo\nthree\n")
        assertEquals(3, number(assertNotNull(manager.info("server.log", 0)), "lines"))

        Files.write(file, "only\n".toByteArray())

        assertEquals(1, number(assertNotNull(manager.info("server.log", 0)), "lines"))
        assertEquals(listOf("only"), readLines("server.log", 0, 10))
    }

    @Test
    fun `rewriting a file with the same size but a newer timestamp rebuilds the index`() {
        val file = writeLog("server.log", "one\ntwo\n", modifiedMillis = 1_000_000)
        assertEquals(2, number(assertNotNull(manager.info("server.log", 0)), "lines"))

        writeLog("server.log", "1\n2\n3\n4\n", modifiedMillis = 2_000_000)
        assertEquals(8, Files.size(file))

        assertEquals(4, number(assertNotNull(manager.info("server.log", 0)), "lines"))
    }

    @Test
    fun `replacing a file with a different one rebuilds the index even when size and time match`() {
        val target = writeLog("server.log", "one\ntwo\n", modifiedMillis = 1_000_000)
        assertEquals(2, number(assertNotNull(manager.info("server.log", 0)), "lines"))

        val replacement = writeLog("staged.txt", "1\n2\n3\n4\n", modifiedMillis = 1_000_000)
        Files.move(replacement, target, StandardCopyOption.REPLACE_EXISTING)
        Files.setLastModifiedTime(target, FileTime.fromMillis(1_000_000))

        assertEquals(4, number(assertNotNull(manager.info("server.log", 0)), "lines"))
        assertEquals(listOf("1", "2", "3", "4"), readLines("server.log", 0, 10))
    }

    @Test
    fun `the index cache keeps at most four files`() {
        for (i in 0 until 7) {
            writeLog("file-$i.log", "line\n")
            assertNotNull(manager.info("file-$i.log", 0))
        }

        assertEquals(4, LogIndexCache.size())
    }

    //
    // * search
    //

    @Test
    fun `search finds the first match forward from the given line`() {
        writeLog("server.log", "alpha\nbeta\nalpha\ngamma\n")

        assertEquals(0, manager.search("server.log", "alpha", 0, true, false, false))
        assertEquals(2, manager.search("server.log", "alpha", 1, true, false, false))
        assertEquals(-1, manager.search("server.log", "alpha", 3, true, false, false))
        assertEquals(-1, manager.search("server.log", "alpha", 99, true, false, false))
    }

    @Test
    fun `search finds the previous match backward from the given line`() {
        writeLog("server.log", "alpha\nbeta\nalpha\ngamma\n")

        assertEquals(2, manager.search("server.log", "alpha", 3, false, false, false))
        assertEquals(0, manager.search("server.log", "alpha", 1, false, false, false))
        assertEquals(-1, manager.search("server.log", "beta", 0, false, false, false))
        assertEquals(2, manager.search("server.log", "alpha", 99, false, false, false))
    }

    @Test
    fun `plain search is case-insensitive unless case sensitivity is requested`() {
        writeLog("server.log", "Alpha\nbeta\n")

        assertEquals(0, manager.search("server.log", "alpha", 0, true, false, false))
        assertEquals(-1, manager.search("server.log", "alpha", 0, true, false, true))
        assertEquals(0, manager.search("server.log", "Alpha", 0, true, false, true))
    }

    @Test
    fun `regex search matches anywhere in the line and honours case sensitivity`() {
        writeLog("server.log", "10:00:00.000 INFO  c.e.Foo - started\nplain text\nERROR boom\n")

        assertEquals(2, manager.search("server.log", "^ERROR\\s", 0, true, true, false))
        assertEquals(0, manager.search("server.log", "c\\.e\\.\\w+", 0, true, true, true))
        assertEquals(2, manager.search("server.log", "error", 0, true, true, false))
        assertEquals(-1, manager.search("server.log", "error", 0, true, true, true))
    }

    @Test
    fun `regex search matches unicode case-insensitively`() {
        writeLog("server.log", "ÉCHEC du démarrage\n")

        assertEquals(0, manager.search("server.log", "échec", 0, true, true, false))
    }

    @Test
    fun `search rejects an invalid regex`() {
        writeLog("server.log", "alpha\n")

        val error = assertFailsWith<IllegalArgumentException> {
            manager.search("server.log", "[unclosed", 0, true, true, false)
        }
        assertTrue(error.message?.startsWith("Invalid regular expression") == true)
    }

    @Test
    fun `search rejects an empty query`() {
        writeLog("server.log", "alpha\n")

        assertFailsWith<IllegalArgumentException> {
            manager.search("server.log", "", 0, true, false, false)
        }
        assertFailsWith<IllegalArgumentException> {
            manager.search("server.log", null, 0, true, false, false)
        }
    }

    @Test
    fun `search spans several blocks and an empty file`() {
        writeLog("server.log", (0 until 5000).joinToString("") { "line-$it\n" })

        assertEquals(4999, manager.search("server.log", "line-4999", 0, true, false, false))
        assertEquals(-1, manager.search("server.log", "line-5000", 0, true, false, false))
        assertEquals(4321, manager.search("server.log", "line-4321", 5000, false, false, false))
        assertEquals(2500, manager.search("server.log", "^line-2500$", 0, true, true, false))

        writeLog("empty.log", "")
        assertEquals(-1, manager.search("empty.log", "anything", 0, true, false, false))
    }

    @Test
    fun `regex search aborts when one line runs past the match budget`() {
        manager.matchBudgetMillis = 50
        // ? Java only backtracks exponentially on this pattern once the line is long.
        writeLog("server.log", "harmless\n" + "a".repeat(20_000) + "!\n")

        assertEquals(-3, manager.search("server.log", "(a+)+b", 0, true, true, false))
        assertEquals(-3, manager.search("server.log", "(a+)+b", 1, false, true, false))
    }

    @Test
    fun `the match budget leaves an ordinary regex alone`() {
        manager.matchBudgetMillis = 50
        writeLog("server.log", "alpha\nbeta-42\n")

        assertEquals(1, manager.search("server.log", "beta-\\d+", 0, true, true, false))
        assertEquals(-1, manager.search("server.log", "gamma", 0, true, true, false))
    }

    @Test
    fun `search aborts when the whole scan runs past the search budget`() {
        manager.searchBudgetMillis = 0
        writeLog("server.log", "alpha\nbeta\n")

        assertEquals(-3, manager.search("server.log", "beta", 0, true, false, false))
        assertEquals(-3, manager.search("server.log", "alpha", 1, false, false, false))
    }

    @Test
    fun `regex search aborts instead of propagating a stack overflow`() {
        // ? This pattern exhausts the stack on a long line rather than reaching the deadline.
        writeLog("server.log", "a".repeat(200_000) + "!\n")

        assertEquals(-3, manager.search("server.log", "(a|aa)+b", 0, true, true, false))
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
                true,
                30_000,
            )
        }
        // ! Started only once the search is parked inside its matcher. Racing the two from the
        // ! start lets the read win on merit, and the test passes even while the monitor is held.
        assertTrue(matching.await(5, TimeUnit.SECONDS), "search never reached the matcher")
        val reader = thread {
            if (index.readJson(0, 1, 1L shl 20, 0) != null) read.countDown()
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
        assertEquals(-3, manager.search("server.log", "(?:(?:){60000}){60000}", 0, true, true, false))
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
            thread { manager.search("server.log", "(?:(?:){30000}){30000}", 0, true, true, false) }
        }
        callers.forEach { it.join(5_000) }

        assertEquals(1, manager.search("server.log", "beta", 0, true, false, false))
    }

    @Test
    fun `the search pool stops replacing stranded threads at its ceiling`() {
        assertEquals(4, searchPoolCeiling(0))
        assertEquals(9, searchPoolCeiling(5))
        assertEquals(20, searchPoolCeiling(16))
        assertEquals(20, searchPoolCeiling(100))
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
                true,
                30_000,
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
                manager.search("server.log", query, 0, true, true, false)
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

        assertEquals(0, manager.search("server.log", "\\d{4}", 0, true, true, false))
        assertEquals(0, manager.search("server.log", "[a-f0-9]{8}", 0, true, true, false))
        assertEquals(0, manager.search("server.log", ".{1,200}", 0, true, true, false))
        assertEquals(0, manager.search("server.log", "(?:\\w{2}){4}", 0, true, true, false))

        // ? Several bounded spans in a row is what hunting through a stack trace looks like. Their
        // ? counts are sequential, so they must not compound into a refusal.
        assertEquals(0, manager.search("server.log", "c\\..{0,1000}code.{0,1000}at.{0,1000}", 0, true, true, false))

        // ? Braces that are not quantifiers: a literal inside a class and an escaped pair.
        assertEquals(-1, manager.search("server.log", "[{20000}]{4}", 0, true, true, false))
        assertEquals(-1, manager.search("server.log", "\\{20000\\}", 0, true, true, false))
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
                manager.search("server.log", query, 0, true, true, false)
            }
            assertTrue(error.message?.contains("extended mode") == true, query)
        }

        // ? Turning it back off is not turning it on, and a plain group is not a flag group.
        assertEquals(0, manager.search("server.log", "(?i-x)alpha", 0, true, true, false))
        assertEquals(0, manager.search("server.log", "(?:alpha)", 0, true, true, false))
        assertEquals(0, manager.search("server.log", "(?i)ALPHA", 0, true, true, false))
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
    fun `search returns the not-found marker for an unknown file`() {
        assertEquals(-2, manager.search("missing.log", "x", 0, true, false, false))
        assertEquals(-2, manager.search("../server.log", "x", 0, true, false, false))
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
            assertNull(manager.info(name, 0), "info accepted '$name'")
            assertNull(manager.read(name, 0, 10, 0), "read accepted '$name'")
            assertNull(manager.download(name), "download accepted '$name'")
        }

        assertNull(manager.info(null, 0))
        assertNull(manager.read(null, 0, 10, 0))
        assertNull(manager.download(null))
    }

    //
    // * download
    //

    @Test
    fun `download exposes the raw file bytes`() {
        writeLog("server.log", "one\ntwo\n")

        val source = assertNotNull(manager.download("server.log"))
        assertEquals("one\ntwo\n", String(source.read(), Charsets.UTF_8))
        assertNull(manager.download("missing.log"))
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
        val json = assertNotNull(manager.read(name, from, count, 0))
        return parseLines(json)
    }

    /** One log entry in XP's Logback layout, `%-5level` padding included. */
    private fun entry(level: String, message: String): String =
        "08:00:00.000 ${level.padEnd(5)} c.e.x.Test - $message\n"

    private fun mask(vararg levels: Byte): Int =
        levels.fold(0) { acc, level -> acc or (1 shl level.toInt()) }

    private fun filteredNumbers(name: String, mask: Int): List<Int> =
        parseNumbers(assertNotNull(manager.read(name, 0, 100, mask)))

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
