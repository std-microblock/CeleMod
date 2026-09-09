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
        assertEquals("Pause", p.top?.binding)
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
        assertEquals("Pause", stick.top?.binding)
        val pad = profile(ControlMode.GAMEPLAY, joystick = false)
        assertFalse(pad.stick); assertTrue(pad.directions); assertFalse(pad.menuDirections)
    }
    @Test fun allDirectionModesWorkInGameplayPicoAndFallback() {
        for (scene in listOf(ControlMode.GAMEPLAY, ControlMode.PICO8, ControlMode.FALLBACK)) {
            for (mode in DirectionControlMode.entries) {
                for ((buttons, joystick) in listOf(true to true, true to false, false to true)) {
                    val p = ControlProfile.forState(ControlState(scene), buttons, joystick, directionMode = mode)
                    assertEquals(mode.isStick, p.stick)
                    assertEquals(!mode.isStick, p.directions)
                    assertEquals(mode == DirectionControlMode.EIGHT_BUTTONS, p.diagonalDirections)
                    assertFalse(p.menuDirections)
                }
            }
        }
    }
    @Test fun directionOverridesNeverEnableDisabledControlsOrChangeMenus() {
        for (mode in DirectionControlMode.entries) {
            for (scene in ControlMode.entries) {
                val p = ControlProfile.forState(ControlState(scene), false, false, directionMode = mode)
                assertFalse(p.stick); assertFalse(p.directions); assertFalse(p.diagonalDirections)
            }
            for (scene in listOf(ControlMode.PAUSE, ControlMode.PAUSE_MENU, ControlMode.MENU, ControlMode.CHAPTER,
                ControlMode.JOURNAL, ControlMode.NAMING, ControlMode.SEARCH)) {
                val p = ControlProfile.forState(ControlState(scene), true, true, directionMode = mode)
                assertFalse(p.stick); assertTrue(p.directions); assertFalse(p.diagonalDirections); assertTrue(p.menuDirections)
                val direct = ControlProfile.forState(ControlState(scene), true, true, direct = true, directionMode = mode)
                assertFalse(direct.stick); assertFalse(direct.directions); assertFalse(direct.diagonalDirections)
            }
        }
    }
    @Test fun diagonalButtonsResolveBothAxesIncludingSplitAndSharedBindings() {
        val defaults = ControlState()
        assertEquals(setOf(19, 21), ControlKeys.resolveAll(defaults, "UpLeft"))
        assertEquals(setOf(19, 22), ControlKeys.resolveAll(defaults, "UpRight"))
        assertEquals(setOf(20, 21), ControlKeys.resolveAll(defaults, "DownLeft"))
        assertEquals(setOf(20, 22), ControlKeys.resolveAll(defaults, "DownRight"))
        val split = ControlState(bindings = mapOf("Up" to emptyList(), "UpMoveOnly" to listOf("W"),
            "UpDashOnly" to listOf("I"), "Left" to listOf("A")))
        assertEquals(setOf(51, 37, 29), ControlKeys.resolveAll(split, "UpLeft"))
        assertEquals(setOf(51, 37), ControlKeys.resolveAll(split.copy(bindings = split.bindings +
            ("Left" to listOf("W"))), "UpLeft"))
        val empty = ControlState(bindings = mapOf("Up" to emptyList(), "Left" to emptyList()))
        assertTrue(ControlKeys.resolveAll(empty, "UpLeft").isEmpty())
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
    @Test fun transitionsNeverFlashVirtualFallbackOrAcceptGameActions() {
        assertEquals(ControlMode.TRANSITION, ControlMode.parse("transition"))
        for (direct in listOf(false, true)) {
            val p = ControlProfile.forState(ControlState(ControlMode.TRANSITION), true, true, direct)
            assertFalse(p.stick); assertFalse(p.directions)
            assertTrue(p.actions.isEmpty()); assertNull(p.top); assertNull(p.auxiliary)
        }
        // Once the transition ends, both real gameplay and unsupported mods retain controls.
        assertTrue(profile(ControlMode.GAMEPLAY).actions.isNotEmpty())
        assertTrue(profile(ControlMode.FALLBACK).actions.isNotEmpty())
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
        assertEquals(117, ControlKeys.fromXna("LeftWindows"))
        assertEquals(120, ControlKeys.fromXna("PrintScreen"))
        assertEquals(116, ControlKeys.fromXna("Scroll"))
        assertEquals(121, ControlKeys.fromXna("Pause"))
        assertNull(ControlKeys.fromXna("None"))
    }

    @Test fun knownEmptyOrUnsupportedBindingsNeverPressSomeOtherActionsDefaultKey() {
        for (keys in listOf(emptyList(), listOf("None"), listOf("UnsupportedKey"))) {
            val state = ControlState(bindings = mapOf("Jump" to keys, "Dash" to listOf("C")))
            assertNull(ControlKeys.resolve(state, "Jump"))
            assertTrue(ControlKeys.resolveAll(state, "Jump").isEmpty())
            assertEquals(setOf(31), ControlKeys.resolveAll(state, "Dash"))
        }
        // Only absent metadata (older/missing hook) gets compatibility defaults.
        assertEquals(setOf(31), ControlKeys.resolveAll(ControlState(), "Jump"))
    }

    @Test fun stickAndDpadCanDriveSeparateMovementAndDashDirections() {
        val state = ControlState(bindings = mapOf("Left" to emptyList(),
            "LeftMoveOnly" to listOf("A"), "LeftDashOnly" to listOf("J")))
        assertEquals(setOf(29, 38), ControlKeys.resolveAll(state, "Left"))
        assertEquals(setOf(21), ControlKeys.resolveAll(state, "MenuLeft"))
        assertEquals(setOf(45), ControlKeys.resolveAll(state.copy(bindings = state.bindings +
            ("Left" to listOf("Q"))), "Left")) // Common key already covers both axes.
        assertEquals(setOf(29), ControlKeys.resolveAll(state.copy(bindings = state.bindings +
            ("LeftDashOnly" to listOf("A"))), "Left")) // Shared key is held once.
        assertTrue(ControlKeys.resolveAll(ControlState(bindings = mapOf("Left" to emptyList())), "Left").isEmpty())
        assertEquals(setOf(29), ControlKeys.resolveAll(ControlState(bindings =
            mapOf("LeftMoveOnly" to listOf("A"))), "Left"))
    }

    @Test fun rebindingAppliesToGameAndMenuActionsIndependently() {
        val state = ControlState(bindings = mapOf("Jump" to listOf("Space"), "MenuConfirm" to listOf("V"),
            "Pause" to listOf("P"), "Up" to listOf("W"), "MenuUp" to listOf("I")))
        assertEquals(setOf(62), ControlKeys.resolveAll(state, "Jump"))
        assertEquals(setOf(50), ControlKeys.resolveAll(state, "MenuConfirm"))
        assertEquals(setOf(44), ControlKeys.resolveAll(state, "Pause"))
        assertEquals(setOf(51), ControlKeys.resolveAll(state, "Up"))
        assertEquals(setOf(37), ControlKeys.resolveAll(state, "MenuUp"))
        assertEquals(setOf(39), ControlKeys.resolveAll(state.copy(bindings = state.bindings +
            ("Jump" to listOf("K"))), "Jump"))
        assertEquals(setOf(111), ControlKeys.resolveAll(state, "ESC"))
    }
}
