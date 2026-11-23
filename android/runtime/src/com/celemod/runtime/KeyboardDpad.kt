package com.celemod.runtime

/**
 * Distinguishes keyboard arrow keys from gamepad D-pad buttons.
 *
 * Many Android USB/Bluetooth keyboards advertise SOURCE_DPAD alongside
 * SOURCE_KEYBOARD, which causes SDL2's SDLControllerManager to consume
 * KEYCODE_DPAD_* as joystick pad events so Celeste's key-remapping UI never
 * receives Keys.Up/Down/Left/Right.
 */
object KeyboardDpad {
    const val KEYCODE_DPAD_UP = 19
    const val KEYCODE_DPAD_DOWN = 20
    const val KEYCODE_DPAD_LEFT = 21
    const val KEYCODE_DPAD_RIGHT = 22

    const val SOURCE_KEYBOARD = 0x00000101
    const val SOURCE_DPAD = 0x00000201
    const val SOURCE_GAMEPAD = 0x00000401
    const val SOURCE_CLASS_JOYSTICK = 0x00000010
    const val KEYBOARD_TYPE_ALPHABETIC = 2

    fun isDpadKey(keyCode: Int): Boolean =
        keyCode == KEYCODE_DPAD_UP ||
            keyCode == KEYCODE_DPAD_DOWN ||
            keyCode == KEYCODE_DPAD_LEFT ||
            keyCode == KEYCODE_DPAD_RIGHT

    /**
     * Returns true when a DPAD key event comes from a keyboard and should go
     * straight to SDL's keyboard path (`onNativeKeyDown`/`onNativeKeyUp`)
     * instead of Android focus navigation or SDL's joystick pad handler.
     */
    fun shouldForwardAsKeyboardKey(
        keyCode: Int,
        deviceId: Int,
        eventSource: Int,
        deviceSources: Int,
        keyboardType: Int,
        isVirtualDevice: Boolean,
        screenKeyboardShown: Boolean,
    ): Boolean {
        if (!isDpadKey(keyCode) || screenKeyboardShown) return false
        if (keyboardType == KEYBOARD_TYPE_ALPHABETIC) {
            val gamepadOnlyEvent =
                (eventSource and SOURCE_GAMEPAD) == SOURCE_GAMEPAD &&
                    (eventSource and SOURCE_KEYBOARD) != SOURCE_KEYBOARD
            return !gamepadOnlyEvent
        }
        if (deviceId <= 0 || isVirtualDevice) {
            val fromGamepad =
                (eventSource and SOURCE_GAMEPAD) == SOURCE_GAMEPAD ||
                    (eventSource and SOURCE_CLASS_JOYSTICK) != 0
            return !fromGamepad
        }
        val hasKeyboard =
            (eventSource and SOURCE_KEYBOARD) == SOURCE_KEYBOARD ||
                (deviceSources and SOURCE_KEYBOARD) == SOURCE_KEYBOARD
        val hasGamepadOrJoystick =
            (deviceSources and SOURCE_GAMEPAD) == SOURCE_GAMEPAD ||
                (deviceSources and SOURCE_CLASS_JOYSTICK) != 0 ||
                (eventSource and SOURCE_GAMEPAD) == SOURCE_GAMEPAD ||
                (eventSource and SOURCE_CLASS_JOYSTICK) != 0
        return hasKeyboard && !hasGamepadOrJoystick
    }
}
