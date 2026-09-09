package com.celemod.runtime

import kotlin.math.abs

/** Layout math and storage format have no Android dependency. Coordinates are normalized centers. */
data class ControlPoint(val x: Float, val y: Float) {
    fun normalized() = ControlPoint(x.coerceIn(0f, 1f), y.coerceIn(0f, 1f))
    val finite get() = x.isFinite() && y.isFinite()
}

data class ControlBounds(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width get() = (right - left).coerceAtLeast(0f)
    val height get() = (bottom - top).coerceAtLeast(0f)
}

object ControlLayout {
    fun encode(positions: Map<String, ControlPoint>): String = "v1\n" + positions.toSortedMap()
        .filter { validId(it.key) && it.value.finite }
        .map { (id, p) -> p.normalized().let { "$id=${it.x},${it.y}" } }.joinToString("\n")

    fun decode(value: String?): Map<String, ControlPoint> {
        if (value == null || value.length > 65536 || !value.startsWith("v1\n")) return emptyMap()
        return buildMap {
            for (line in value.lineSequence().drop(1).take(128)) {
                val parts = line.split('=', ',', limit = 4)
                if (parts.size != 3 || !validId(parts[0])) continue
                val x = parts[1].toFloatOrNull() ?: continue
                val y = parts[2].toFloatOrNull() ?: continue
                val p = ControlPoint(x, y)
                if (p.finite) put(parts[0], p.normalized())
            }
        }
    }

    internal fun validId(id: String) = id.isNotEmpty() && id.length <= 80 &&
        id.all { it.isLetterOrDigit() || it in "/-_" }

    fun normalize(center: ControlPoint, bounds: ControlBounds) = ControlPoint(
        if (bounds.width > 0) (center.x - bounds.left) / bounds.width else .5f,
        if (bounds.height > 0) (center.y - bounds.top) / bounds.height else .5f
    ).normalized()

    fun project(position: ControlPoint, bounds: ControlBounds) = ControlPoint(
        bounds.left + position.x * bounds.width, bounds.top + position.y * bounds.height)

    /** Keep the whole control visible and the fixed editor/exit toolbar reachable. */
    fun constrain(center: ControlPoint, halfWidth: Float, halfHeight: Float,
                  bounds: ControlBounds, toolbar: ControlBounds): ControlPoint {
        val hw = halfWidth.coerceIn(0f, bounds.width / 2)
        val hh = halfHeight.coerceIn(0f, bounds.height / 2)
        val x = center.x.coerceIn(bounds.left + hw, bounds.right - hw)
        val y = center.y.coerceIn(bounds.top + hh, bounds.bottom - hh)
        if (x + hw <= toolbar.left || x - hw >= toolbar.right ||
            y + hh <= toolbar.top || y - hh >= toolbar.bottom) return ControlPoint(x, y)
        val right = toolbar.right + hw
        val below = toolbar.bottom + hh
        return when {
            right <= bounds.right - hw && (below > bounds.bottom - hh || abs(right - x) < abs(below - y)) -> ControlPoint(right, y)
            below <= bounds.bottom - hh -> ControlPoint(x, below)
            else -> ControlPoint(x, y) // Degenerate, smaller-than-a-control viewport.
        }
    }
}

/** Changes stay private until Save. Reset is also undoable by cancelling the editor. */
class ControlLayoutDraft(saved: Map<String, ControlPoint>, savedStyles: Map<String, ControlStyle> = emptyMap()) {
    private val positions = saved.toMutableMap()
    private val styles = savedStyles.toMutableMap()
    fun snapshot(): Map<String, ControlPoint> = positions.toMap()
    fun styleSnapshot(): Map<String, ControlStyle> = styles.toMap()
    fun style(id: String) = styles[id] ?: ControlStyle()
    fun setStyle(id: String, style: ControlStyle) { styles[id] = style.normalized() }
    /** Copy only button settings, never positions or the group's direction mode. */
    fun setDirectionStyles(group: String, mode: DirectionControlMode, source: ControlStyle) {
        for (id in mode.buttonIds(group)) setStyle(id, source.copy(directionMode = style(id).directionMode))
    }
    fun get(id: String) = positions[id]
    fun move(id: String, point: ControlPoint) { if (point.finite) positions[id] = point.normalized() }
    fun restore(id: String, point: ControlPoint?) { if (point == null) positions.remove(id) else positions[id] = point }
    fun reset() { positions.clear(); styles.clear() }
}
