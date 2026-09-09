package com.celemod.runtime

import org.junit.Assert.*
import org.junit.Test

class ModButtonTest {
    @Test fun ownedCodesResolveOnlyAvailableCustomButtons() {
        val buttons = listOf(ModButton("chat", "聊天", -1, true), ModButton("tools", "工具", -2, true),
            ModButton("gone", "已禁用", -3, false))
        assertEquals(listOf("chat", "tools"), ModButtons.held(buttons, setOf(-1, -2, -3, 29)))
        assertEquals(emptyList<String>(), ModButtons.held(buttons, emptySet()))
    }
    @Test fun customControlsAreIndependentOfDefaultButtonsButNotTextEntry() {
        val state = ControlState(ControlMode.GAMEPLAY, modButtons = listOf(ModButton("chat", "聊天", -1, true)))
        assertTrue(ControlProfile.forState(state, false, false).actions.isEmpty())
        assertTrue(ModButtons.visible(state.mode))
        assertTrue(ModButtons.visible(ControlMode.MENU))
        assertFalse(ModButtons.visible(ControlMode.LOADING))
        assertFalse(ModButtons.visible(ControlMode.TRANSITION))
        assertFalse(ModButtons.visible(ControlMode.NAMING))
        assertFalse(ModButtons.visible(ControlMode.SEARCH))
    }
    @Test fun customLayoutIdsRoundTripAndDraftCancelIsolated() {
        val id = "game/custom/9bc6a620-0476-49f0-a597-676c710121f1"
        val saved = mapOf(id to ControlPoint(.6f, .2f))
        assertEquals(saved, ControlLayout.decode(ControlLayout.encode(saved)))
        val draft = ControlLayoutDraft(saved)
        draft.move(id, ControlPoint(.2f, .8f)); draft.reset()
        assertEquals(ControlPoint(.6f, .2f), saved[id])
        val styles = mapOf(id to ControlStyle(scale = 1.5f, slide = ControlSlideBehavior.ADDITIVE))
        assertEquals(styles, ControlStyle.decode(ControlStyle.encode(styles)))
    }
}
