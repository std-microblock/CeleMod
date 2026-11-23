package com.celemod.runtime

import java.io.File

/**
 * Pure validation and naming helpers for importing a Celeste game directory
 * selected through Android's Storage Access Framework (ACTION_OPEN_DOCUMENT_TREE).
 */
object GameImport {
    const val MAX_TOTAL_BYTES = 16L * 1024 * 1024 * 1024
    const val MAX_FILES = 100_000
    const val MAX_DEPTH = 32
    const val STAGING_PREFIX = ".import-"

    data class TreeEntry(val id: String, val name: String, val isDirectory: Boolean)

    fun isSafeSegment(name: String): Boolean =
        name.isNotBlank() &&
            name != "." &&
            name != ".." &&
            name.none { it == '/' || it == '\\' || it == '\u0000' || it.code < 0x20 }

    fun sanitizeDirectoryName(raw: String?): String {
        val withoutVolume = raw
            ?.replaceFirst(Regex("""^(?:primary|home|[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}):"""), "")
            .orEmpty()
        val leaf = withoutVolume
            .substringAfterLast('/')
            .substringAfterLast('\\')
            .trim()
        val cleaned = leaf
            .replace(Regex("""[/\\:*?"<>|\u0000-\u001f]"""), "_")
            .trimStart('.')
            .trim()
        if (cleaned.isEmpty() || cleaned == "." || cleaned == "..") return "Celeste"
        if (cleaned.startsWith("Steam-") && cleaned.contains(".download-")) {
            return "Imported-" + cleaned.replace(".download-", "-")
        }
        return cleaned.take(64)
    }

    fun uniqueTargetDirectory(root: File, baseName: String): File {
        val safeBase = sanitizeDirectoryName(baseName)
        var candidate = File(root, safeBase)
        var suffix = 2
        while (candidate.exists()) {
            candidate = File(root, "$safeBase-$suffix")
            suffix++
        }
        return candidate
    }

    fun isValidCelesteListing(entries: List<TreeEntry>): Boolean {
        val hasContentDir = entries.any { it.isDirectory && it.name == "Content" }
        val hasExecutable = entries.any { !it.isDirectory && (it.name == "Celeste.exe" || it.name == "Celeste.dll") }
        return hasContentDir && hasExecutable
    }

    /**
     * Resolves the document id and sanitized folder name for a valid Celeste install.
     * Supports selecting either the game directory itself or a wrapper directory
     * containing a single Celeste subfolder.
     */
    fun resolveSourceRoot(
        rootId: String,
        rootName: String?,
        listChildren: (String) -> List<TreeEntry>,
    ): Pair<String, String>? {
        val top = listChildren(rootId)
        if (isValidCelesteListing(top)) {
            return rootId to sanitizeDirectoryName(rootName)
        }
        val nestedDirs = top.filter {
            it.isDirectory &&
                isSafeSegment(it.name) &&
                !it.name.startsWith(".") &&
                it.name != "__MACOSX"
        }
        if (nestedDirs.size == 1) {
            val child = nestedDirs[0]
            if (isValidCelesteListing(listChildren(child.id))) {
                return child.id to sanitizeDirectoryName(child.name)
            }
        }
        return null
    }
}
