package com.celemod.runtime

import org.junit.Assert.*
import org.junit.Test

class ControlProfileTest {
    private fun profile(mode: ControlMode, buttons: Boolean = true, joystick: Boolean = true) =
        ControlProfile.forState(ControlState(mode), buttons, joystick)

    @Test fun pauseReplacesStickAndGameplayActions() {
        val p = profile(ControlMode.PAUSE)
        assertFalse(p.stick); assertTrue(p.directions); assertTrue(p.menuDirections)
        assertEquals(ControlIcon.PLAY, p.top?.icon)
        assertEquals("ESC", p.top?.binding)
        assertEquals(listOf("MenuConfirm", "MenuCancel"), p.actions.map { it.binding })
    }
    @Test fun pauseSubmenusGoBackInsteadOfPretendingToResume() {
        assertEquals(ControlIcon.BACK, profile(ControlMode.PAUSE_MENU).top?.icon)
        assertEquals("ESC", profile(ControlMode.PAUSE_MENU).top?.binding)
        assertEquals("MenuCancel", profile(ControlMode.MENU).top?.binding)
    }
    @Test fun joystickOnlyStillHasUsableMenus() {
        for (mode in listOf(ControlMode.PAUSE, ControlMode.PAUSE_MENU, ControlMode.MENU, ControlMode.CHAPTER, ControlMode.NAMING)) {
            val p = profile(mode, buttons = false)
            assertTrue(p.directions); assertFalse(p.stick); assertTrue(p.actions.isNotEmpty())
        }
    }
    @Test fun disabledControlsStayDisabled() {
        for (mode in ControlMode.entries) {
            val p = profile(mode, false, false)
            assertFalse(p.stick); assertFalse(p.directions); assertTrue(p.actions.isEmpty())
            assertNull(p.top); assertNull(p.auxiliary)
        }
    }
    @Test fun gameplayRestoresUserPreference() {
        val stick = profile(ControlMode.GAMEPLAY)
        assertTrue(stick.stick); assertFalse(stick.directions)
        assertEquals(listOf("Jump", "Dash", "Grab"), stick.actions.map { it.binding })
        assertEquals(ControlIcon.PAUSE, stick.top?.icon)
        val pad = profile(ControlMode.GAMEPLAY, joystick = false)
        assertFalse(pad.stick); assertTrue(pad.directions); assertFalse(pad.menuDirections)
    }
    @Test fun onlyNearbyInteractionsAddTalk() {
        assertFalse(profile(ControlMode.GAMEPLAY).actions.any { it.binding == "Talk" })
        assertTrue(ControlProfile.forState(ControlState(ControlMode.GAMEPLAY, canTalk = true), true, true)
            .actions.any { it.binding == "Talk" })
    }
    @Test fun dialogueAndLoadingRemoveMovement() {
        for (mode in listOf(ControlMode.DIALOGUE, ControlMode.LOADING, ControlMode.COMPLETE)) {
            val p = profile(mode)
            assertFalse(p.stick); assertFalse(p.directions)
            assertFalse(p.actions.any { it.binding in listOf("Jump", "Dash", "Grab") })
        }
        assertEquals("继续", profile(ControlMode.DIALOGUE).actions.first().label)
        assertTrue(profile(ControlMode.LOADING).actions.isEmpty())
    }
    @Test fun journalAndNamingHaveContextActions() {
        assertEquals("MenuJournal", profile(ControlMode.CHAPTER).auxiliary?.binding)
        assertEquals("关闭", profile(ControlMode.JOURNAL).actions.first().label)
        assertEquals("输入", profile(ControlMode.NAMING).actions.first().label)
        assertTrue(profile(ControlMode.NAMING).actions.any { it.binding == "Pause" && it.label == "完成" })
        val keyboard = ControlProfile.forState(ControlState(ControlMode.NAMING, keyboard = true), true, true)
        assertEquals("Keyboard", keyboard.auxiliary?.binding)
        assertEquals("Enter", keyboard.actions.first().binding)
    }
    @Test fun unknownModScenesKeepFallbackControls() {
        assertEquals(ControlMode.FALLBACK, ControlMode.parse("future-mode"))
        val p = profile(ControlMode.FALLBACK)
        assertTrue(p.actions.any { it.binding == "Jump" })
        assertTrue(p.actions.any { it.binding == "MenuConfirm" })
        assertEquals(ControlMode.PAUSE, ControlMode.parse("pause"))
    }
    @Test fun searchOffersKeyboardOnlyWhenTextInputIsActive() {
        assertNull(profile(ControlMode.SEARCH).auxiliary)
        val search = ControlProfile.forState(ControlState(ControlMode.SEARCH, keyboard = true), true, true)
        assertEquals("Keyboard", search.auxiliary?.binding)
        assertEquals("搜索", search.actions.first().label)
        assertEquals("ESC", search.top?.binding)
    }
    @Test fun actualKeyboardBindingsOverrideDefaults() {
        val state = ControlState(bindings = mapOf("Jump" to listOf("Space"), "MenuConfirm" to listOf("None", "V")))
        assertEquals(62, ControlKeys.resolve(state, "Jump"))
        assertEquals(50, ControlKeys.resolve(state, "MenuConfirm"))
        assertEquals(111, ControlKeys.resolve(state, "ESC"))
        assertEquals(19, ControlKeys.resolve(state, "MenuUp"))
        assertEquals(113, ControlKeys.fromXna("LeftControl"))
        assertEquals(144, ControlKeys.fromXna("NumPad0"))
        assertEquals(142, ControlKeys.fromXna("F12"))
        assertNull(ControlKeys.fromXna("None"))
    }
}
