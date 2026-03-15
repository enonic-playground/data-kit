package com.enonic.app.datakit

import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path

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

internal fun jsonString(value: String?): String {
    if (value.isNullOrEmpty()) return "\"\""
    return "\"${value.escapeJson()}\""
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
