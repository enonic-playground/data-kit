package com.enonic.app.datakit

import com.enonic.xp.home.HomeDir
import org.osgi.service.component.annotations.Component
import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.deleteIfExists
import kotlin.io.path.readText
import kotlin.io.path.writeText

private const val METADATA_FILE = ".datakit-export.json"
private val NODE_COUNT_REGEX = """"nodeCount"\s*:\s*(\d+)""".toRegex()

@Component(immediate = true)
class ExportManager {
    fun list(): String {
        val exportDir = exportDirectory()
        if (!Files.isDirectory(exportDir)) return "[]"

        val entries = mutableListOf<String>()

        try {
            Files.newDirectoryStream(exportDir).use { stream ->
                for (entry in stream) {
                    val json = buildEntryJson(entry) ?: continue
                    entries += json
                }
            }
        } catch (e: IOException) {
            throw RuntimeException("Failed to list exports: ${e.message}", e)
        }

        return entries.joinToString(",", prefix = "[", postfix = "]")
    }

    fun delete(name: String?): Boolean {
        if (name.isNullOrEmpty()) return false

        val exportDir = exportDirectory()
        val target = exportDir.resolve(name).normalize()
        if (!target.startsWith(exportDir)) return false

        try {
            if (Files.isDirectory(target)) {
                target.deleteRecursively()
                deleteSidecarMetadata(exportDir, name)
                return true
            }

            val archive = exportDir.resolve("$name.zip").normalize()
            if (Files.isRegularFile(archive)) {
                Files.delete(archive)
                deleteSidecarMetadata(exportDir, name)
                return true
            }

            return false
        } catch (e: IOException) {
            throw RuntimeException("Failed to delete export '$name': ${e.message}", e)
        }
    }

    fun writeMetadata(name: String, nodeCount: Int) {
        val exportDir = exportDirectory()
        val target = exportDir.resolve(name).normalize()
        if (!target.startsWith(exportDir)) return

        val json = """{"nodeCount":$nodeCount}"""

        try {
            if (Files.isDirectory(target)) {
                target.resolve(METADATA_FILE).writeText(json)
            } else {
                exportDir.resolve("$name.$METADATA_FILE").writeText(json)
            }
        } catch (_: IOException) {
            // ? Metadata is non-critical; export already succeeded
        }
    }

    private fun buildEntryJson(entry: Path): String? {
        val fileName = entry.fileName.toString()
        if (fileName.endsWith(".$METADATA_FILE")) return null

        return when {
            Files.isDirectory(entry) -> buildDirectoryEntry(entry, fileName)
            fileName.endsWith(".zip") -> buildArchiveEntry(entry, fileName.removeSuffix(".zip"))
            else -> null
        }
    }

    private fun buildDirectoryEntry(dir: Path, name: String): String {
        val timestamp = dir.lastModifiedOrEmpty()
        val nodeCount = readNodeCountFromDir(dir)
        val size = dir.directorySizeSafe()

        return jsonEntry(name, timestamp, "directory", nodeCount, size)
    }

    private fun buildArchiveEntry(archive: Path, name: String): String {
        return try {
            val size = Files.size(archive)
            val timestamp = archive.lastModifiedOrEmpty()
            val nodeCount = readNodeCountFromSidecar(archive.parent, name)

            jsonEntry(name, timestamp, "zip", nodeCount, size)
        } catch (_: IOException) {
            val nodeCount = readNodeCountFromSidecar(archive.parent, name)
            jsonEntry(name, archive.lastModifiedOrEmpty(), "zip", nodeCount, -1)
        }
    }

    private fun readNodeCountFromDir(dir: Path): Long =
        readNodeCountFromFile(dir.resolve(METADATA_FILE))

    private fun readNodeCountFromSidecar(exportDir: Path, name: String): Long =
        readNodeCountFromFile(exportDir.resolve("$name.$METADATA_FILE"))

    private fun readNodeCountFromFile(metadata: Path): Long {
        if (!Files.isRegularFile(metadata)) return -1

        return try {
            NODE_COUNT_REGEX.find(metadata.readText())
                ?.groupValues
                ?.get(1)
                ?.toLongOrNull()
                ?: -1
        } catch (_: IOException) {
            -1
        }
    }

    private fun deleteSidecarMetadata(exportDir: Path, name: String) {
        try {
            exportDir.resolve("$name.$METADATA_FILE").deleteIfExists()
        } catch (_: IOException) {
            // ? Sidecar cleanup is best-effort
        }
    }

    private fun jsonEntry(
        name: String,
        timestamp: String,
        format: String,
        nodeCount: Long,
        size: Long,
    ): String = buildString {
        append('{')
        append("\"name\":")
        append(jsonString(name))
        append(",\"timestamp\":")
        append(jsonString(timestamp))
        append(",\"format\":")
        append(jsonString(format))
        append(",\"nodeCount\":")
        append(nodeCount)
        append(",\"size\":")
        append(size)
        append('}')
    }
}

private fun exportDirectory(): Path =
    HomeDir.get().toFile().toPath().resolve("data").resolve("export")
