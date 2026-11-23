package com.celemod.runtime

import org.junit.Assert.*
import org.junit.Test

class KeyboardDpadTest {
    @Test fun alphabeticKeyboardArrowKeysBypassJoystickAndFocusNavigation() {
        for (code in listOf(
            KeyboardDpad.KEYCODE_DPAD_UP,
            KeyboardDpad.KEYCODE_DPAD_DOWN,
            KeyboardDpad.KEYCODE_DPAD_LEFT,
            KeyboardDpad.KEYCODE_DPAD_RIGHT,
        )) {
            assertTrue(
                "Keyboard advertising SOURCE_DPAD must still emit keyboard arrow keys",
                KeyboardDpad.shouldForwardAsKeyboardKey(
                    keyCode = code,
                    deviceId = 7,
                    eventSource = KeyboardDpad.SOURCE_KEYBOARD,
                    deviceSources = KeyboardDpad.SOURCE_KEYBOARD or KeyboardDpad.SOURCE_DPAD,
                    keyboardType = KeyboardDpad.KEYBOARD_TYPE_ALPHABETIC,
                    isVirtualDevice = false,
                    screenKeyboardShown = false,
                ),
            )
            assertTrue(
                "Keyboard reporting SOURCE_DPAD on the event itself must still emit keyboard arrow keys",
                KeyboardDpad.shouldForwardAsKeyboardKey(
                    keyCode = code,
                    deviceId = 7,
                    eventSource = KeyboardDpad.SOURCE_DPAD,
                    deviceSources = KeyboardDpad.SOURCE_KEYBOARD or KeyboardDpad.SOURCE_DPAD,
                    keyboardType = KeyboardDpad.KEYBOARD_TYPE_ALPHABETIC,
                    isVirtualDevice = false,
                    screenKeyboardShown = false,
                ),
            )
        }
    }

    @Test fun physicalGamepadDpadRemainsGamepadInput() {
        for (code in listOf(
            KeyboardDpad.KEYCODE_DPAD_UP,
            KeyboardDpad.KEYCODE_DPAD_DOWN,
            KeyboardDpad.KEYCODE_DPAD_LEFT,
            KeyboardDpad.KEYCODE_DPAD_RIGHT,
        )) {
            assertFalse(
                "Real gamepad D-pad must not be hijacked as keyboard keys",
                KeyboardDpad.shouldForwardAsKeyboardKey(
                    keyCode = code,
                    deviceId = 12,
                    eventSource = KeyboardDpad.SOURCE_DPAD or KeyboardDpad.SOURCE_GAMEPAD,
                    deviceSources = KeyboardDpad.SOURCE_GAMEPAD or KeyboardDpad.SOURCE_CLASS_JOYSTICK or KeyboardDpad.SOURCE_DPAD,
                    keyboardType = 1,
                    isVirtualDevice = false,
                    screenKeyboardShown = false,
                ),
            )
        }
    }

    @Test fun virtualKeyboardDpadForwardsWhenSoftKeyboardClosedOnly() {
        assertTrue(
            KeyboardDpad.shouldForwardAsKeyboardKey(
                keyCode = KeyboardDpad.KEYCODE_DPAD_LEFT,
                deviceId = -1,
                eventSource = KeyboardDpad.SOURCE_KEYBOARD,
                deviceSources = 0,
                keyboardType = 0,
                isVirtualDevice = true,
                screenKeyboardShown = false,
            ),
        )
        assertFalse(
            KeyboardDpad.shouldForwardAsKeyboardKey(
                keyCode = KeyboardDpad.KEYCODE_DPAD_LEFT,
                deviceId = -1,
                eventSource = KeyboardDpad.SOURCE_KEYBOARD,
                deviceSources = 0,
                keyboardType = 0,
                isVirtualDevice = true,
                screenKeyboardShown = true,
            ),
        )
        assertFalse(
            KeyboardDpad.shouldForwardAsKeyboardKey(
                keyCode = 29, // KEYCODE_A
                deviceId = 7,
                eventSource = KeyboardDpad.SOURCE_KEYBOARD,
                deviceSources = KeyboardDpad.SOURCE_KEYBOARD,
                keyboardType = KeyboardDpad.KEYBOARD_TYPE_ALPHABETIC,
                isVirtualDevice = false,
                screenKeyboardShown = false,
            ),
        )
    }
}
