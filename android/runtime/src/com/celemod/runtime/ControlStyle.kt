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

enum class DirectionControlMode(val label: String) {
    STICK("摇杆"), FOUR_BUTTONS("四键按钮"), EIGHT_BUTTONS("八键按钮");

    companion object {
        fun parse(value: String?) = entries.firstOrNull { it.name == value }
        fun default(joystick: Boolean) = if (joystick) STICK else FOUR_BUTTONS
    }
}

data class ControlStyle(
    val scale: Float = 1f,
    val slide: ControlSlideBehavior = ControlSlideBehavior.HOLD,
    val opacity: Float = 1f,
    val enterVibration: Boolean = false,
    val leaveVibration: Boolean = false,
    val enterStrength: Int = 50,
    val leaveStrength: Int = 50,
    // Only game/stick uses this field. Null preserves the launcher's old preference.
    val directionMode: DirectionControlMode? = null
) {
    fun normalized() = copy(
        scale = if (scale.isFinite()) scale.coerceIn(.5f, 2f) else 1f,
        opacity = if (opacity.isFinite()) opacity.coerceIn(0f, 1f) else 1f,
        enterStrength = enterStrength.coerceIn(0, 100),
        leaveStrength = leaveStrength.coerceIn(0, 100))

    fun vibrationStrength(entering: Boolean): Int =
        if (entering) { if (enterVibration) enterStrength.coerceIn(0, 100) else 0 }
        else { if (leaveVibration) leaveStrength.coerceIn(0, 100) else 0 }

    companion object {
        val strengthPresets: List<Int> = (0..100 step 10).toList()

        fun encode(styles: Map<String, ControlStyle>) = "v2\n" + styles.toSortedMap()
            .filterKeys { ControlLayout.validId(it) }.map { (id, style) ->
                val value = style.normalized()
                "$id=${value.scale},${value.slide.name},${value.opacity},${value.enterVibration},${value.leaveVibration},${value.enterStrength},${value.leaveStrength},${value.directionMode?.name ?: "DEFAULT"}"
            }.joinToString("\n")

        fun decode(raw: String?): Map<String, ControlStyle> {
            if (raw == null || raw.length > 65536 || !(raw.startsWith("v1\n") || raw.startsWith("v2\n"))) return emptyMap()
            val legacy = raw.startsWith("v1\n")
            return buildMap {
                for (line in raw.lineSequence().drop(1).take(128)) {
                    val parts = line.split('=', ',', limit = 10)
                    if (parts.size != (if (legacy) 3 else 9) || !ControlLayout.validId(parts[0])) continue
                    val scale = parts[1].toFloatOrNull()?.takeIf { it.isFinite() } ?: continue
                    val style = ControlStyle(scale, ControlSlideBehavior.parse(parts[2]))
                    put(parts[0], (if (legacy) style else style.copy(
                        opacity = parts[3].toFloatOrNull() ?: 1f,
                        enterVibration = parts[4].toBooleanStrictOrNull() ?: false,
                        leaveVibration = parts[5].toBooleanStrictOrNull() ?: false,
                        enterStrength = parts[6].toIntOrNull() ?: 50,
                        leaveStrength = parts[7].toIntOrNull() ?: 50,
                        directionMode = DirectionControlMode.parse(parts[8]))).normalized())
                }
            }
        }
    }
}

/** Physical contact, independent of HOLD/ADDITIVE key ownership and SDL tap pulses.
 * A second finger on the same button does not retrigger; only the last one leaves. */
class ControlContacts {
    data class Change(val id: String, val entering: Boolean)
    private var touching = emptySet<String>()
    fun update(next: Set<String>): List<Change> {
        val changes = (touching - next).map { Change(it, false) } +
            (next - touching).map { Change(it, true) }
        touching = next.toSet()
        return changes
    }
    fun clear() { touching = emptySet() }
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
