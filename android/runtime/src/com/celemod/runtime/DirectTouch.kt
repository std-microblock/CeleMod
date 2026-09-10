package com.celemod.runtime

import kotlin.math.*

/** Rectangles are normalized to the SDL surface (viewport) or the game's HUD (targets). */
data class TouchRect(val x: Float, val y: Float, val w: Float, val h: Float) {
    val valid get() = listOf(x, y, w, h).all { it.isFinite() } && w > 0 && h > 0
    fun contains(p: ControlPoint) = p.x >= x && p.y >= y && p.x <= x + w && p.y <= y + h
    fun local(p: ControlPoint) = ControlPoint((p.x - x) / w, (p.y - y) / h)
}
data class TouchTarget(val id: String, val rect: TouchRect, val kind: String, val label: String,
                       val text: String = "", val maxLength: Int = 128)
data class TouchScene(val epoch: String, val kind: String, val viewport: TouchRect, val targets: List<TouchTarget>) {
    fun hit(p: ControlPoint) = targets.lastOrNull { it.rect.contains(p) }
}
data class TouchIntent(val epoch: String, val id: String, val action: String,
                       val x: Float = 0f, val y: Float = 0f, val value: Float = 0f, val text: String = "")

/** Single-finger gestures. A drag can never activate the row under its release point. */
class DirectGesture(private val scene: TouchScene, val target: TouchTarget, private val start: ControlPoint,
                    private val pixelWidth: Float, private val pixelHeight: Float, private val slop: Float) {
    private var previous = start
    private var moved = false
    private var axis = ""
    private var swipeSent = false
    private var scrollRemainder = 0f
    private fun intent(action: String, p: ControlPoint, value: Float = 0f) =
        TouchIntent(scene.epoch, target.id, action, p.x, p.y, value)

    fun move(p: ControlPoint): TouchIntent? {
        val dx = (p.x - start.x) * pixelWidth
        val dy = (p.y - start.y) * pixelHeight
        if (!moved && hypot(dx, dy) > slop) {
            moved = true
            axis = if (abs(dx) > abs(dy)) "x" else "y"
        }
        var result: TouchIntent? = null
        if (moved) {
            if (target.kind == "pan") {
                if (p != previous) result = intent("pan", ControlPoint(p.x - previous.x, p.y - previous.y))
            }
            else if (target.kind == "slider" && axis == "x") result = intent("adjust", p)
            else if (scene.kind in setOf("menu", "search", "main") && axis == "y") {
                scrollRemainder += (previous.y - p.y) * 1080 / 32
                val steps = scrollRemainder.toInt().coerceIn(-12, 12)
                if (steps != 0) {
                    scrollRemainder -= steps
                    result = intent("scroll", p, steps.toFloat())
                }
            } else if (!swipeSent && scene.kind in setOf("chapters", "journal", "cards", "main", "chat")) {
                // Respond as soon as direction is clear, not only after finger-up.
                // One page/level-set change per gesture avoids skipping through animations.
                swipeSent = true
                val delta = if (axis == "x") start.x - p.x else start.y - p.y
                result = intent(if (axis == "y" && scene.kind != "cards") "swipeY" else "swipe", p, sign(delta))
            }
        }
        previous = p
        return result
    }

    fun finish(p: ControlPoint, latest: TouchScene?, elapsedMillis: Long): TouchIntent? {
        if (latest?.epoch != scene.epoch) return null
        // A platform may coalesce the whole swipe into ACTION_UP.
        val finalMove = move(p)
        if (moved) {
            return finalMove
        }
        if (elapsedMillis > 1500) return null
        val live = latest.targets.firstOrNull { it.id == target.id } ?: return null
        if (!live.rect.contains(p) || latest.hit(p)?.id != target.id) return null
        return intent(if (target.kind in setOf("text", "number")) "keyboard" else "tap", p)
    }
}
