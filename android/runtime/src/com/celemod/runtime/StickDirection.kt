package com.celemod.runtime

import kotlin.math.abs

/** The exact eight-way sectors used for both SDL input and direction feedback.
 * The vector has already passed through the configured stick dead zone. */
enum class StickDirection(val horizontal: String?, val vertical: String?) {
    RIGHT("Right", null), DOWN_RIGHT("Right", "Down"), DOWN(null, "Down"),
    DOWN_LEFT("Left", "Down"), LEFT("Left", null), UP_LEFT("Left", "Up"),
    UP(null, "Up"), UP_RIGHT("Right", "Up");

    val diagonal get() = horizontal != null && vertical != null
    val bindings get() = listOfNotNull(horizontal, vertical)

    companion object {
        fun fromVector(x: Float, y: Float): StickDirection? {
            if (!x.isFinite() || !y.isFinite() || x == 0f && y == 0f) return null
            val horizontal = if (abs(x) >= abs(y) * .41421356f) (if (x < 0) "Left" else "Right") else null
            val vertical = if (abs(y) >= abs(x) * .41421356f) (if (y < 0) "Up" else "Down") else null
            return entries.first { it.horizontal == horizontal && it.vertical == vertical }
        }
    }
}

/** Track directions, not just cardinal/diagonal categories: Right -> Up is a
 * change too. Entering neutral is distinct from staying there or ending a gesture. */
class StickDirectionFeedback {
    private var previous: StickDirection? = null
    var enteredDeadZone = false
        private set
    fun update(next: StickDirection?): StickDirection? {
        enteredDeadZone = previous != null && next == null
        if (next == previous) return null
        previous = next
        return next
    }
    fun clear() { previous = null; enteredDeadZone = false }
}
