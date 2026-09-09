package com.celemod.runtime

/** The behavior belongs to the first action pressed and lasts for that finger's gesture. */
enum class ControlSlideBehavior(val label: String) {
    TRANSFER("切换：离开 A 松开 A，滑到 B 按下 B"),
    ADDITIVE("叠加：保持 A，滑过的 B 也按住，抬手一起松开"),
    HOLD("锁定：只按住最初的 A，滑到 B 不触发 B");

    companion object {
        fun parse(value: String?) = entries.firstOrNull { it.name == value } ?: HOLD
    }
}

data class ControlStyle(val scale: Float = 1f, val slide: ControlSlideBehavior = ControlSlideBehavior.HOLD) {
    fun normalized() = copy(scale = if (scale.isFinite()) scale.coerceIn(.5f, 2f) else 1f)

    companion object {
        fun encode(styles: Map<String, ControlStyle>) = "v1\n" + styles.toSortedMap()
            .filterKeys { ControlLayout.validId(it) }.map { (id, style) ->
                val value = style.normalized()
                "$id=${value.scale},${value.slide.name}"
            }.joinToString("\n")

        fun decode(raw: String?): Map<String, ControlStyle> {
            if (raw == null || raw.length > 65536 || !raw.startsWith("v1\n")) return emptyMap()
            return buildMap {
                for (line in raw.lineSequence().drop(1).take(128)) {
                    val parts = line.split('=', ',', limit = 4)
                    if (parts.size != 3 || !ControlLayout.validId(parts[0])) continue
                    val scale = parts[1].toFloatOrNull()?.takeIf { it.isFinite() } ?: continue
                    put(parts[0], ControlStyle(scale, ControlSlideBehavior.parse(parts[2])).normalized())
                }
            }
        }
    }
}

/** IDs, not keycodes: two fingers and rebound/shared keys keep independent ownership. */
class ActionSlideGesture(first: String, private val behavior: ControlSlideBehavior) {
    private val held = linkedSetOf(first)
    fun active(): Set<String> = held.toSet()
    fun move(target: String?) {
        when (behavior) {
            ControlSlideBehavior.TRANSFER -> { held.clear(); if (target != null) held += target }
            ControlSlideBehavior.ADDITIVE -> if (target != null) held += target
            ControlSlideBehavior.HOLD -> Unit
        }
    }
}
