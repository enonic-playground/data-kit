package com.enonic.app.datakit

import com.google.common.io.ByteSource
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.InvalidPathException
import java.nio.file.Path
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

internal fun Path.resolveChildEntry(name: String): Path? =
    try {
        val base = normalize()
        val target = base.resolve(name).normalize()
        if (target.parent == base && target.fileName.toString() == name) target else null
    } catch (_: InvalidPathException) {
        null
    }

internal fun Path.directorySize(): Long {
    var size = 0L

    Files.newDirectoryStream(this).use { stream ->
        for (entry in stream) {
            size += when {
                Files.isDirectory(entry) -> entry.directorySize()
                Files.isRegularFile(entry) -> Files.size(entry)
                else -> 0L
            }
        }
    }

    return size
}

internal fun Path.directorySizeSafe(): Long =
    try {
        directorySize()
    } catch (_: IOException) {
        -1
    }

internal fun Path.deleteRecursively() {
    if (Files.isDirectory(this)) {
        Files.newDirectoryStream(this).use { stream ->
            for (entry in stream) {
                entry.deleteRecursively()
            }
        }
    }

    Files.delete(this)
}

internal fun Path.lastModifiedOrEmpty(): String =
    try {
        Files.getLastModifiedTime(this).toInstant().toString()
    } catch (_: IOException) {
        ""
    }

internal fun Path.zipToByteSource(): ByteSource {
    val buffer = ByteArrayOutputStream()

    ZipOutputStream(buffer).use { zos ->
        Files.walk(this).use { paths ->
            for (path in paths) {
                if (Files.isRegularFile(path)) {
                    val entryName = this.relativize(path).toString()
                    zos.putNextEntry(ZipEntry(entryName))
                    Files.newInputStream(path).use { input -> input.copyTo(zos) }
                    zos.closeEntry()
                }
            }
        }
    }

    return ByteSource.wrap(buffer.toByteArray())
}

internal fun saveStream(target: Path, source: InputStream) {
    Files.copy(source, target)
}

internal fun jsonString(value: String?): String {
    if (value.isNullOrEmpty()) return "\"\""
    return "\"${value.escapeJson()}\""
}

/**
 * UTF-8 bytes this string occupies once written as a JSON string, quotes included, without
 * building it. Escaping expands content up to sixfold and multi-byte characters expand on the
 * wire, so a line can pass a budget counted over raw file bytes and still emit far more. Keep
 * the escape widths in step with [escapeJson]; an unpaired surrogate is deliberately over-charged.
 */
internal fun jsonStringBytes(value: String?): Long {
    if (value.isNullOrEmpty()) return 2L

    var total = 2L
    for (ch in value) {
        total += when {
            ch == '\\' || ch == '"' || ch == '\n' || ch == '\r' || ch == '\t' -> 2L
            ch.code < 0x20 -> 6L
            ch.code < 0x80 -> 1L
            ch.code < 0x800 -> 2L
            else -> 3L
        }
    }
    return total
}

private fun String.escapeJson(): String = buildString(length + 8) {
    for (ch in this@escapeJson) {
        when (ch) {
            '\\' -> append("\\\\")
            '"' -> append("\\\"")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            else -> {
                if (ch.code < 0x20) {
                    append("\\u")
                    append(ch.code.toString(16).padStart(4, '0'))
                } else {
                    append(ch)
                }
            }
        }
    }
}
