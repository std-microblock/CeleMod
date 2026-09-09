package com.celemod.runtime

import android.view.KeyEvent

/** XNA key names from actual Celeste bindings, not a hardcoded C/X/Z assumption. */
object ControlKeys {
    private val directions = setOf("Up", "Down", "Left", "Right")
    private val defaults = mapOf(
        "Jump" to KeyEvent.KEYCODE_C, "Dash" to KeyEvent.KEYCODE_X, "Grab" to KeyEvent.KEYCODE_Z,
        "Talk" to KeyEvent.KEYCODE_X, "Pause" to KeyEvent.KEYCODE_ENTER,
        "MenuConfirm" to KeyEvent.KEYCODE_C, "MenuCancel" to KeyEvent.KEYCODE_X,
        "MenuJournal" to KeyEvent.KEYCODE_TAB,
        "Up" to KeyEvent.KEYCODE_DPAD_UP, "Down" to KeyEvent.KEYCODE_DPAD_DOWN,
        "Left" to KeyEvent.KEYCODE_DPAD_LEFT, "Right" to KeyEvent.KEYCODE_DPAD_RIGHT,
        "MenuUp" to KeyEvent.KEYCODE_DPAD_UP, "MenuDown" to KeyEvent.KEYCODE_DPAD_DOWN,
        "MenuLeft" to KeyEvent.KEYCODE_DPAD_LEFT, "MenuRight" to KeyEvent.KEYCODE_DPAD_RIGHT,
        "ESC" to KeyEvent.KEYCODE_ESCAPE, "Enter" to KeyEvent.KEYCODE_ENTER, "Backspace" to KeyEvent.KEYCODE_DEL
    )
    private val special = mapOf(
        "Up" to 19, "Down" to 20, "Left" to 21, "Right" to 22,
        "Enter" to 66, "Escape" to 111, "Space" to 62, "Tab" to 61, "Back" to 67,
        "LeftShift" to 59, "RightShift" to 60, "LeftControl" to 113, "RightControl" to 114,
        "LeftAlt" to 57, "RightAlt" to 58, "CapsLock" to 115, "NumLock" to 143,
        "LeftWindows" to KeyEvent.KEYCODE_META_LEFT, "RightWindows" to KeyEvent.KEYCODE_META_RIGHT,
        "PrintScreen" to KeyEvent.KEYCODE_SYSRQ, "Scroll" to KeyEvent.KEYCODE_SCROLL_LOCK, "Pause" to KeyEvent.KEYCODE_BREAK,
        "Home" to 122, "End" to 123, "PageUp" to 92, "PageDown" to 93, "Insert" to 124, "Delete" to 112,
        "OemMinus" to 69, "OemPlus" to 70, "OemOpenBrackets" to 71, "OemCloseBrackets" to 72,
        "OemPipe" to 73, "OemBackslash" to 73, "OemSemicolon" to 74, "OemQuotes" to 75,
        "OemComma" to 55, "OemPeriod" to 56, "OemQuestion" to 76, "OemTilde" to 68,
        "Multiply" to 155, "Add" to 157, "Subtract" to 156, "Decimal" to 158, "Divide" to 154
    )
    internal fun fromXna(name: String): Int? = when {
        name.length == 1 && name[0] in 'A'..'Z' -> KeyEvent.KEYCODE_A + (name[0] - 'A')
        name.length == 2 && name[0] == 'D' && name[1] in '0'..'9' -> KeyEvent.KEYCODE_0 + (name[1] - '0')
        name.startsWith("NumPad") && name.removePrefix("NumPad").toIntOrNull() in 0..9 ->
            KeyEvent.KEYCODE_NUMPAD_0 + name.removePrefix("NumPad").toInt()
        name.startsWith("F") && name.drop(1).toIntOrNull() in 1..12 -> KeyEvent.KEYCODE_F1 + name.drop(1).toInt() - 1
        else -> special[name]
    }
    fun resolve(state: ControlState, action: String): Int? =
        if (state.bindings.containsKey(action)) state.bindings[action]?.firstNotNullOfOrNull(::fromXna)
        else defaults[action]

    /** One common direction key controls both movement and aim. If it is unbound,
     * press the separate move/aim bindings together, never an unrelated arrow key. */
    fun resolveAll(state: ControlState, action: String): Set<Int> {
        if (action !in directions) return setOfNotNull(resolve(state, action))
        state.bindings[action]?.firstNotNullOfOrNull(::fromXna)?.let { return setOf(it) }
        val split = listOf(action + "MoveOnly", action + "DashOnly")
        if (state.bindings.containsKey(action) || split.any(state.bindings::containsKey))
            return split.mapNotNull { state.bindings[it]?.firstNotNullOfOrNull(::fromXna) }.toSet()
        return setOfNotNull(defaults[action])
    }
}
