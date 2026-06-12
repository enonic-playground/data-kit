package com.enonic.app.datakit

import com.enonic.xp.home.HomeDir
import com.google.common.io.ByteSource
import com.google.common.io.Files as GuavaFiles
import org.osgi.service.component.annotations.Component
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.Path
import java.util.Properties
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import kotlin.io.path.readText

private val DUMP_JSON_STRING_REGEX = """"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"""".toRegex()
private val DUMP_JSON_NUMBER_REGEX = """"([^"]+)"\s*:\s*(\d+)""".toRegex()

@Component(immediate = true)
class DumpManager {
    fun list(): String {
        val dumpDir = dumpDirectory()
        if (!Files.isDirectory(dumpDir)) return "[]"

        val entries = mutableListOf<String>()

        try {
            Files.newDirectoryStream(dumpDir).use { stream ->
                for (entry in stream) {
                    val json = buildEntryJson(entry) ?: continue
                    entries += json
                }
            }
        } catch (e: IOException) {
            throw RuntimeException("Failed to list dumps: ${e.message}", e)
        }

        return entries.joinToString(",", prefix = "[", postfix = "]")
    }

    fun delete(name: String?): Boolean {
        if (name.isNullOrEmpty()) return false

        val dumpDir = dumpDirectory()
        val target = dumpDir.resolveChildEntry(name) ?: return false

        try {
            if (Files.isDirectory(target)) {
                target.deleteRecursively()
                return true
            }

            val archive = dumpDir.resolve("$name.zip")
            if (Files.isRegularFile(archive)) {
                Files.delete(archive)
                return true
            }

            return false
        } catch (e: IOException) {
            throw RuntimeException("Failed to delete dump '$name': ${e.message}", e)
        }
    }

    fun download(name: String?): ByteSource? {
        if (name.isNullOrEmpty()) return null

        val dumpDir = dumpDirectory()
        val target = dumpDir.resolveChildEntry(name) ?: return null

        val archive = dumpDir.resolve("$name.zip")
        if (Files.isRegularFile(archive)) {
            return GuavaFiles.asByteSource(archive.toFile())
        }

        if (Files.isDirectory(target) && isValidDumpDirectory(target)) {
            return target.zipToByteSource()
        }

        return null
    }

    fun upload(name: String?, data: InputStream?): Boolean {
        if (name.isNullOrEmpty() || data == null) return false

        val dumpDir = dumpDirectory()
        val entry = dumpDir.resolveChildEntry(name) ?: return false
        val target = dumpDir.resolve("$name.zip")

        if (Files.exists(target) || Files.isDirectory(entry)) return false

        val tempFile = dumpDir.resolve(".$name.zip.tmp")

        try {
            if (!Files.isDirectory(dumpDir)) {
                Files.createDirectories(dumpDir)
            }
            try {
                saveStream(tempFile, data)
                Files.move(tempFile, target)
            } finally {
                Files.deleteIfExists(tempFile)
            }
            return true
        } catch (e: IOException) {
            throw RuntimeException("Failed to upload dump '$name': ${e.message}", e)
        }
    }

    private fun isValidDumpDirectory(dir: Path): Boolean {
        return Files.isRegularFile(dir.resolve("dump.json")) ||
            Files.isRegularFile(dir.resolve("export.properties"))
    }

    private fun buildEntryJson(entry: Path): String? {
        val name = entry.fileName.toString()

        return when {
            Files.isDirectory(entry) -> buildDirectoryEntry(entry, name)
            name.endsWith(".zip") -> buildArchiveEntry(entry, name.removeSuffix(".zip"))
            else -> null
        }
    }

    private fun buildDirectoryEntry(dir: Path, name: String): String? {
        val dumpJson = dir.resolve("dump.json")
        val exportProperties = dir.resolve("export.properties")

        if (Files.isRegularFile(dumpJson)) {
            return try {
                val content = dumpJson.readText()
                val xpVersion = extractJsonString(content, "xpVersion")
                val modelVersion = extractJsonValue(content, "modelVersion")
                val timestamp = extractJsonString(content, "timestamp")
                val size = dir.directorySize()

                jsonEntry(name, timestamp, "versioned", xpVersion, modelVersion, size)
            } catch (_: IOException) {
                jsonEntry(name, dir.lastModifiedOrEmpty(), "versioned", "", "", dir.directorySizeSafe())
            }
        }

        if (Files.isRegularFile(exportProperties)) {
            return try {
                val props = Properties()
                Files.newInputStream(exportProperties).use { input ->
                    props.load(input)
                }

                val xpVersion = props.getProperty("xp.version") ?: ""
                jsonEntry(name, dir.lastModifiedOrEmpty(), "export", xpVersion, "", dir.directorySize())
            } catch (_: IOException) {
                jsonEntry(name, dir.lastModifiedOrEmpty(), "export", "", "", dir.directorySizeSafe())
            }
        }

        return null
    }

    private fun buildArchiveEntry(archive: Path, name: String): String {
        return try {
            val size = Files.size(archive)
            var xpVersion = ""
            var modelVersion = ""
            var timestamp = archive.lastModifiedOrEmpty()

            ZipFile(archive.toFile()).use { zip ->
                val dumpJsonEntry = findDumpJson(zip) ?: return@use

                zip.getInputStream(dumpJsonEntry).reader(Charsets.UTF_8).use { reader ->
                    val content = reader.readText()
                    xpVersion = extractJsonString(content, "xpVersion")
                    modelVersion = extractJsonValue(content, "modelVersion")

                    val archiveTimestamp = extractJsonString(content, "timestamp")
                    if (archiveTimestamp.isNotEmpty()) {
                        timestamp = archiveTimestamp
                    }
                }
            }

            jsonEntry(name, timestamp, "archived", xpVersion, modelVersion, size)
        } catch (_: IOException) {
            jsonEntry(name, archive.lastModifiedOrEmpty(), "archived", "", "", -1)
        }
    }

    private fun findDumpJson(zip: ZipFile): ZipEntry? {
        val entries = zip.entries()

        while (entries.hasMoreElements()) {
            val entry = entries.nextElement()
            if (entry.name == "dump.json" || entry.name.endsWith("/dump.json")) {
                return entry
            }
        }

        return null
    }

    private fun extractJsonString(json: String, key: String): String {
        for (match in DUMP_JSON_STRING_REGEX.findAll(json)) {
            if (match.groupValues[1] == key) {
                return match.groupValues[2]
            }
        }

        return ""
    }

    private fun extractJsonValue(json: String, key: String): String {
        val number = extractJsonNumber(json, key)
        if (number.isNotEmpty()) return number
        return extractJsonString(json, key)
    }

    private fun extractJsonNumber(json: String, key: String): String {
        for (match in DUMP_JSON_NUMBER_REGEX.findAll(json)) {
            if (match.groupValues[1] == key) {
                return match.groupValues[2]
            }
        }

        return ""
    }

    private fun jsonEntry(
        name: String,
        timestamp: String,
        type: String,
        xpVersion: String,
        modelVersion: String,
        size: Long,
    ): String = buildString {
        append('{')
        append("\"name\":")
        append(jsonString(name))
        append(",\"timestamp\":")
        append(jsonString(timestamp))
        append(",\"type\":")
        append(jsonString(type))
        append(",\"xpVersion\":")
        append(jsonString(xpVersion))
        append(",\"modelVersion\":")
        append(jsonString(modelVersion))
        append(",\"size\":")
        append(size)
        append('}')
    }
}

private fun dumpDirectory(): Path =
    HomeDir.get().toFile().toPath().resolve("data").resolve("dump")
