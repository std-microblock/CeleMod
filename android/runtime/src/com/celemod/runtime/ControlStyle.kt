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
    STICK("固定摇杆"), FLOATING_STICK("浮动摇杆"), FOUR_BUTTONS("四键按钮"), EIGHT_BUTTONS("八键按钮");

    val isStick get() = this == STICK || this == FLOATING_STICK

    fun buttonIds(group: String): List<String> {
        require(group == "game" || group == "menu")
        if (isStick) return emptyList()
        val directions = listOf("Left", "Down", "Right", "Up") +
            if (this == EIGHT_BUTTONS && group == "game") listOf("UpLeft", "UpRight", "DownLeft", "DownRight") else emptyList()
        return directions.map { "$group/dpad/$it" }
    }

    companion object {
        fun parse(value: String?) = entries.firstOrNull { it.name == value }
        fun default(joystick: Boolean) = if (joystick) STICK else FOUR_BUTTONS
    }
}

/** Whether the four/eight direction controls are laid out and edited as one pad. */
enum class DirectionLayoutMode(val label: String) {
    INDIVIDUAL("独立按钮"), MERGED("合并按钮");
    companion object { fun parse(value: String?) = entries.firstOrNull { it.name == value } ?: INDIVIDUAL }
}

enum class StickDisplayMode(val label: String) {
    CLASSIC("经典摇杆"), RING("圆环模式");

    companion object {
        fun parse(value: String?) = entries.firstOrNull { it.name == value } ?: CLASSIC
    }
}

enum class DirectionSlideBehavior(val label: String) {
    RELEASE("移出后松开；滑入其他方向时切换"),
    KEEP_LAST("移出后保持最后方向；滑入其他方向时切换，抬手松开");

    companion object {
        fun parse(value: String?) = entries.firstOrNull { it.name == value } ?: RELEASE
    }
}

/** The starting direction owns the policy for this finger, even after crossing
 * a button with another policy. At most one direction button is held per finger. */
class DirectionSlideGesture(first: String, private val behavior: DirectionSlideBehavior) {
    private var held: String? = first
    fun active(): String? = held
    fun move(target: String?) {
        if (target != null || behavior == DirectionSlideBehavior.RELEASE) held = target
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
    val directionMode: DirectionControlMode? = null,
    val directionLayout: DirectionLayoutMode = DirectionLayoutMode.INDIVIDUAL,
    val directionSlide: DirectionSlideBehavior = DirectionSlideBehavior.RELEASE,
    val stickDiagonalVibration: Boolean = false,
    val stickCardinalVibration: Boolean = false,
    val stickDiagonalStrength: Int = 50,
    val stickCardinalStrength: Int = 50,
    val stickDeadZone: Float = .18f,
    val stickDeadZoneVibration: Boolean = false,
    val stickDeadZoneStrength: Int = 50,
    val stickDisplay: StickDisplayMode = StickDisplayMode.CLASSIC
) {
    fun normalized() = copy(
        scale = if (scale.isFinite()) scale.coerceIn(.5f, 3f) else 1f,
        opacity = if (opacity.isFinite()) opacity.coerceIn(0f, 1f) else 1f,
        enterStrength = enterStrength.coerceIn(0, 100),
        leaveStrength = leaveStrength.coerceIn(0, 100),
        stickDiagonalStrength = stickDiagonalStrength.coerceIn(0, 100),
        stickCardinalStrength = stickCardinalStrength.coerceIn(0, 100),
        stickDeadZone = StickInput.deadZone(stickDeadZone),
        stickDeadZoneStrength = stickDeadZoneStrength.coerceIn(0, 100))

    fun vibrationStrength(entering: Boolean): Int =
        if (entering) { if (enterVibration) enterStrength.coerceIn(0, 100) else 0 }
        else { if (leaveVibration) leaveStrength.coerceIn(0, 100) else 0 }

    fun stickVibrationStrength(direction: StickDirection): Int =
        if (direction.diagonal) { if (stickDiagonalVibration) stickDiagonalStrength.coerceIn(0, 100) else 0 }
        else { if (stickCardinalVibration) stickCardinalStrength.coerceIn(0, 100) else 0 }

    fun deadZoneVibrationStrength() = if (stickDeadZoneVibration) stickDeadZoneStrength.coerceIn(0, 100) else 0

    /** Direction mode is layout-owned and deliberately never copied between buttons. */
    fun withChanges(before: ControlStyle, after: ControlStyle) = copy(
        scale = if (before.scale != after.scale) after.scale else scale,
        opacity = if (before.opacity != after.opacity) after.opacity else opacity,
        directionLayout = if (before.directionLayout != after.directionLayout) after.directionLayout else directionLayout,
        slide = if (before.slide != after.slide) after.slide else slide,
        directionSlide = if (before.directionSlide != after.directionSlide) after.directionSlide else directionSlide,
        enterVibration = if (before.enterVibration != after.enterVibration) after.enterVibration else enterVibration,
        leaveVibration = if (before.leaveVibration != after.leaveVibration) after.leaveVibration else leaveVibration,
        enterStrength = if (before.enterStrength != after.enterStrength) after.enterStrength else enterStrength,
        leaveStrength = if (before.leaveStrength != after.leaveStrength) after.leaveStrength else leaveStrength,
        stickDiagonalVibration = if (before.stickDiagonalVibration != after.stickDiagonalVibration) after.stickDiagonalVibration else stickDiagonalVibration,
        stickCardinalVibration = if (before.stickCardinalVibration != after.stickCardinalVibration) after.stickCardinalVibration else stickCardinalVibration,
        stickDiagonalStrength = if (before.stickDiagonalStrength != after.stickDiagonalStrength) after.stickDiagonalStrength else stickDiagonalStrength,
        stickCardinalStrength = if (before.stickCardinalStrength != after.stickCardinalStrength) after.stickCardinalStrength else stickCardinalStrength,
        stickDeadZone = if (before.stickDeadZone != after.stickDeadZone) after.stickDeadZone else stickDeadZone,
        stickDeadZoneVibration = if (before.stickDeadZoneVibration != after.stickDeadZoneVibration) after.stickDeadZoneVibration else stickDeadZoneVibration,
        stickDeadZoneStrength = if (before.stickDeadZoneStrength != after.stickDeadZoneStrength) after.stickDeadZoneStrength else stickDeadZoneStrength,
        stickDisplay = if (before.stickDisplay != after.stickDisplay) after.stickDisplay else stickDisplay)

    companion object {
        val strengthPresets: List<Int> = (0..100 step 10).toList()

        fun encode(styles: Map<String, ControlStyle>) = "v2\n" + styles.toSortedMap()
            .filterKeys { ControlLayout.validId(it) }.map { (id, style) ->
                val value = style.normalized()
                "$id=${value.scale},${value.slide.name},${value.opacity},${value.enterVibration},${value.leaveVibration},${value.enterStrength},${value.leaveStrength},${value.directionMode?.name ?: "DEFAULT"},${value.directionLayout.name},${value.directionSlide.name},${value.stickDiagonalVibration},${value.stickCardinalVibration},${value.stickDiagonalStrength},${value.stickCardinalStrength},${value.stickDeadZone},${value.stickDeadZoneVibration},${value.stickDeadZoneStrength},${value.stickDisplay.name}"
            }.joinToString("\n")

        fun decode(raw: String?): Map<String, ControlStyle> {
            if (raw == null || raw.length > 65536 || !(raw.startsWith("v1\n") || raw.startsWith("v2\n"))) return emptyMap()
            val legacy = raw.startsWith("v1\n")
            return buildMap {
                for (line in raw.lineSequence().drop(1).take(128)) {
                    val parts = line.split('=', ',', limit = 20)
                    if ((if (legacy) parts.size != 3 else parts.size !in listOf(9, 10, 14, 17, 18, 19)) || !ControlLayout.validId(parts[0])) continue
                    val scale = parts[1].toFloatOrNull()?.takeIf { it.isFinite() } ?: continue
                    val style = ControlStyle(scale, ControlSlideBehavior.parse(parts[2]))
                    val oldV2 = !legacy && parts.size < 19
                    val directionLayoutIndex = if (oldV2) -1 else 9
                    val directionSlideIndex = if (oldV2) 9 else 10
                    val diagonalVibrationIndex = if (oldV2) 10 else 11
                    val cardinalVibrationIndex = if (oldV2) 11 else 12
                    val diagonalStrengthIndex = if (oldV2) 12 else 13
                    val cardinalStrengthIndex = if (oldV2) 13 else 14
                    val deadZoneIndex = if (oldV2) 14 else 15
                    val deadZoneVibrationIndex = if (oldV2) 15 else 16
                    val deadZoneStrengthIndex = if (oldV2) 16 else 17
                    val displayIndex = if (oldV2) -1 else 18
                    put(parts[0], (if (legacy) style else style.copy(
                        opacity = parts[3].toFloatOrNull() ?: 1f,
                        enterVibration = parts[4].toBooleanStrictOrNull() ?: false,
                        leaveVibration = parts[5].toBooleanStrictOrNull() ?: false,
                        enterStrength = parts[6].toIntOrNull() ?: 50,
                        leaveStrength = parts[7].toIntOrNull() ?: 50,
                        directionMode = DirectionControlMode.parse(parts[8]),
                        directionLayout = DirectionLayoutMode.parse(if (directionLayoutIndex >= 0) parts.getOrNull(directionLayoutIndex) else null),
                        directionSlide = DirectionSlideBehavior.parse(parts.getOrNull(directionSlideIndex)),
                        stickDiagonalVibration = parts.getOrNull(diagonalVibrationIndex)?.toBooleanStrictOrNull() ?: false,
                        stickCardinalVibration = parts.getOrNull(cardinalVibrationIndex)?.toBooleanStrictOrNull() ?: false,
                        stickDiagonalStrength = parts.getOrNull(diagonalStrengthIndex)?.toIntOrNull() ?: 50,
                        stickCardinalStrength = parts.getOrNull(cardinalStrengthIndex)?.toIntOrNull() ?: 50,
                        stickDeadZone = parts.getOrNull(deadZoneIndex)?.toFloatOrNull() ?: .18f,
                        stickDeadZoneVibration = parts.getOrNull(deadZoneVibrationIndex)?.toBooleanStrictOrNull() ?: false,
                        stickDeadZoneStrength = parts.getOrNull(deadZoneStrengthIndex)?.toIntOrNull() ?: 50,
                        stickDisplay = StickDisplayMode.parse(if (displayIndex >= 0) parts.getOrNull(displayIndex) else null))).normalized())
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
