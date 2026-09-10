package com.celemod.runtime

import org.junit.Assert.*
import org.junit.Test

class ModTouchTest {
    @Test fun chatUsesRawKeysAndKeepsSendAndKeyboardInDirectMode() {
        val state = ControlState(ControlMode.CHAT, keyboard = true, bindings = mapOf("ESC" to listOf("P"), "MenuConfirm" to listOf("V")))
        for (direct in listOf(false, true)) {
            val profile = ControlProfile.forState(state, false, true, direct)
            assertFalse(profile.stick); assertFalse(profile.directions)
            assertEquals(listOf("Enter", "Backspace"), profile.actions.map { it.binding })
            assertEquals("Keyboard", profile.auxiliary?.binding)
            assertEquals("Escape", profile.top?.binding)
            assertEquals(111, ControlKeys.resolve(state, profile.top!!.binding))
            assertEquals(66, ControlKeys.resolve(state, "Enter"))
        }
        assertFalse(ModButtons.visible(ControlMode.CHAT))
    }
    @Test fun lobbyMapKeepsZoomConfirmAndNavigationAlongsideDrag() {
        for (direct in listOf(false, true)) {
            val profile = ControlProfile.forState(ControlState(ControlMode.LOBBY_MAP), false, true, direct)
            assertFalse(profile.stick); assertTrue(profile.directions); assertTrue(profile.menuDirections)
            assertEquals(listOf("MenuConfirm", "MenuCancel", "MenuJournal"), profile.actions.map { it.binding })
        }
        val view = ControlProfile.forState(ControlState(ControlMode.LOBBY_MAP_VIEW), true, false, true)
        assertTrue(view.directions)
        assertFalse(view.actions.any { it.binding == "MenuConfirm" })
    }
    @Test fun shortcutsUseLiveBindingsWithoutInventingDefaults() {
        val state = ControlState(ControlMode.GAMEPLAY, bindings = mapOf("MiaoChat" to listOf("Y"),
            "MiaoPlayers" to listOf("Tab"), "CollabMap" to listOf("M")))
        assertTrue(ControlProfile.forState(state, true, false).actions.map { it.binding }
            .containsAll(listOf("MiaoChat", "MiaoPlayers", "CollabMap")))
        assertEquals(53, ControlKeys.resolve(state, "MiaoChat"))
        assertNull(ControlKeys.resolve(ControlState(), "MiaoChat"))
        val unbound = state.copy(bindings = mapOf("MiaoChat" to emptyList()))
        assertFalse(ControlProfile.forState(unbound, true, false).actions.any { it.binding == "MiaoChat" })
    }
    private fun mapScene() = TouchScene("map:1", "lobby_map", TouchRect(0f, 0f, 1f, 1f),
        listOf(TouchTarget("collab/map", TouchRect(0f, 0f, 1f, 1f), "pan", "地图")))
    @Test fun mapDragUsesIncrementalDeltasNeverConfirmAndRejectsChangedLobby() {
        val scene = mapScene()
        val g = DirectGesture(scene, scene.targets.single(), ControlPoint(.4f, .4f), 1920f, 1080f, 12f)
        val move = g.move(ControlPoint(.5f, .45f))!!
        assertEquals("pan", move.action); assertEquals(.1f, move.x, .0001f); assertEquals(.05f, move.y, .0001f)
        val next = g.move(ControlPoint(.6f, .45f))!!
        assertEquals(.1f, next.x, .0001f)
        assertNotEquals("tap", g.finish(ControlPoint(.6f, .45f), scene, 300)?.action)
        assertNull(g.finish(ControlPoint(.7f, .45f), scene.copy(epoch = "map:2"), 350))
    }
    @Test fun chatTextTapOpensKeyboardAndTabSwipeDoesNotSend() {
        val scene = TouchScene("chat:1", "chat", TouchRect(0f, 0f, 1f, 1f), listOf(
            TouchTarget("text", TouchRect(0f, .9f, 1f, .1f), "text", "输入")))
        val g = DirectGesture(scene, scene.targets.single(), ControlPoint(.4f, .95f), 1920f, 1080f, 12f)
        assertEquals("keyboard", g.finish(ControlPoint(.4f, .95f), scene, 200)?.action)
        val tabs = scene.copy(targets = listOf(scene.targets.single().copy(id = "chat/tabs", kind = "swipe")))
        val swipe = DirectGesture(tabs, tabs.targets.single(), ControlPoint(.4f, .95f), 1920f, 1080f, 12f)
        assertEquals("swipe", swipe.move(ControlPoint(.1f, .95f))?.action)
        assertNull(swipe.finish(ControlPoint(.1f, .95f), tabs, 300))
    }
}
