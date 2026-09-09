package com.celemod.runtime

import kotlin.math.hypot
import kotlin.math.max

object StickInput {
    fun deadZone(value: Float) = if (value.isFinite()) value.coerceIn(0f, .9f) else .18f

    /** Ratios are relative to the base radius, not the moving knob's size. */
    fun vector(x: Float, y: Float, deadZone: Float): ControlPoint {
        if (!x.isFinite() || !y.isFinite()) return ControlPoint(0f, 0f)
        val length = hypot(x, y)
        if (length == 0f || length < StickInput.deadZone(deadZone)) return ControlPoint(0f, 0f)
        return ControlPoint(x / max(1f, length), y / max(1f, length))
    }

    /** Left half of the usable screen, below the toolbar. Buttons still win hit tests. */
    fun floatingArea(bounds: ControlBounds, toolbar: ControlBounds) = ControlBounds(
        bounds.left, max(bounds.top, toolbar.bottom).coerceAtMost(bounds.bottom),
        bounds.left + bounds.width / 2, bounds.bottom)

    fun contains(area: ControlBounds, point: ControlPoint) = point.finite &&
        point.x >= area.left && point.x < area.right && point.y >= area.top && point.y < area.bottom
}

/** One finger owns the stick. A floating origin is latched at touch-down, never
 * moved by dragging or a second finger, and never written to saved layouts. */
class StickGesture {
    var pointer: Int = -1
        private set
    var center: ControlPoint? = null
        private set

    fun begin(pointerId: Int, point: ControlPoint, fixedCenter: ControlPoint?, area: ControlBounds, radius: Float): Boolean {
        if (pointer != -1 || pointerId < 0 || !point.finite || !radius.isFinite() || radius <= 0) return false
        val inside = if (fixedCenter != null) hypot(point.x - fixedCenter.x, point.y - fixedCenter.y) <= radius * 1.3f
            else StickInput.contains(area, point)
        if (!inside) return false
        pointer = pointerId; center = fixedCenter ?: point
        return true
    }

    fun vector(point: ControlPoint, radius: Float, deadZone: Float): ControlPoint {
        val origin = center ?: return ControlPoint(0f, 0f)
        if (!radius.isFinite() || radius <= 0) return ControlPoint(0f, 0f)
        return StickInput.vector((point.x - origin.x) / radius, (point.y - origin.y) / radius, deadZone)
    }

    fun end(pointerId: Int): Boolean {
        if (pointer == -1 || pointerId != pointer) return false
        clear(); return true
    }
    fun clear() { pointer = -1; center = null }
}
