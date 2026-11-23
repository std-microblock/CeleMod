package com.celemod.runtime

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files

class GameImportTest {
    @Test fun rejectsUnsafePathSegments() {
        assertTrue(GameImport.isSafeSegment("Celeste.exe"))
        assertTrue(GameImport.isSafeSegment("Content"))
        assertFalse(GameImport.isSafeSegment(""))
        assertFalse(GameImport.isSafeSegment("   "))
        assertFalse(GameImport.isSafeSegment("."))
        assertFalse(GameImport.isSafeSegment(".."))
        assertFalse(GameImport.isSafeSegment("a/b"))
        assertFalse(GameImport.isSafeSegment("a\\b"))
        assertFalse(GameImport.isSafeSegment("bad\u0000name"))
    }

    @Test fun sanitizesDirectoryNamesAndAvoidsCollisions() {
        assertEquals("Celeste", GameImport.sanitizeDirectoryName("primary:Download/Celeste"))
        assertEquals("Celeste", GameImport.sanitizeDirectoryName("..."))
        assertEquals("Celeste", GameImport.sanitizeDirectoryName(null))
        assertEquals("My_Game", GameImport.sanitizeDirectoryName("My:Game"))
        assertFalse(
            GameImport.sanitizeDirectoryName("Steam-123.download-tmp").contains(".download-"),
        )

        val root = Files.createTempDirectory("celemod-import-test").toFile()
        try {
            val first = GameImport.uniqueTargetDirectory(root, "Celeste")
            assertEquals("Celeste", first.name)
            first.mkdirs()
            val second = GameImport.uniqueTargetDirectory(root, "Celeste")
            assertEquals("Celeste-2", second.name)
            second.mkdirs()
            val third = GameImport.uniqueTargetDirectory(root, "Celeste")
            assertEquals("Celeste-3", third.name)
        } finally {
            root.deleteRecursively()
        }
    }

    @Test fun resolvesDirectAndSingleNestedCelesteFoldersOnly() {
        val validEntries = listOf(
            GameImport.TreeEntry("c", "Content", isDirectory = true),
            GameImport.TreeEntry("e", "Celeste.exe", isDirectory = false),
        )
        assertEquals(
            "root" to "Celeste",
            GameImport.resolveSourceRoot("root", "primary:Games/Celeste") { validEntries },
        )

        val nested = mapOf(
            "root" to listOf(
                GameImport.TreeEntry("inner", "Celeste-Linux", isDirectory = true),
                GameImport.TreeEntry("mac", "__MACOSX", isDirectory = true),
            ),
            "inner" to listOf(
                GameImport.TreeEntry("c", "Content", isDirectory = true),
                GameImport.TreeEntry("d", "Celeste.dll", isDirectory = false),
            ),
        )
        assertEquals(
            "inner" to "Celeste-Linux",
            GameImport.resolveSourceRoot("root", "Archive") { nested[it].orEmpty() },
        )

        // Missing Content directory is rejected.
        assertNull(
            GameImport.resolveSourceRoot("root", "Incomplete") {
                listOf(GameImport.TreeEntry("e", "Celeste.exe", isDirectory = false))
            },
        )
        // Missing Celeste executable is rejected.
        assertNull(
            GameImport.resolveSourceRoot("root", "OnlyContent") {
                listOf(GameImport.TreeEntry("c", "Content", isDirectory = true))
            },
        )
    }
}
