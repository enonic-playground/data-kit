package com.enonic.app.datakit

import com.enonic.xp.home.HomeDir
import org.osgi.service.component.annotations.Component

@Component(immediate = true)
class SystemInfoProvider {
    fun getJavaVersion(): String = System.getProperty("java.version") ?: ""

    fun getJavaVendor(): String = System.getProperty("java.vendor") ?: ""

    fun getOsName(): String = System.getProperty("os.name") ?: ""

    fun getOsArch(): String = System.getProperty("os.arch") ?: ""

    fun getOsVersion(): String = System.getProperty("os.version") ?: ""

    fun getXpHome(): String = HomeDir.get()?.toFile()?.absolutePath ?: ""

    fun getDiskTotal(): Long = diskSpace { it.totalSpace }

    fun getDiskUsable(): Long = diskSpace { it.usableSpace }

    private inline fun diskSpace(read: (java.io.File) -> Long): Long {
        val home = HomeDir.get()?.toFile() ?: return 0
        return try {
            read(home)
        } catch (_: SecurityException) {
            0
        }
    }
}
