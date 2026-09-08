package com.celemod.runtime

import org.junit.Assert.*
import org.junit.Test

class DirectTouchTest {
    private val box = TouchRect(.2f, .2f, .6f, .2f)
    private val row = TouchTarget("row", box, "tap", "继续")
    private fun scene(kind: String = "menu", target: TouchTarget = row) =
        TouchScene("session:1", kind, TouchRect(.1f, 0f, .8f, 1f), listOf(target))
    private fun gesture(s: TouchScene = scene(), start: ControlPoint = ControlPoint(.4f, .3f)) =
        DirectGesture(s, s.targets.last(), start, 1920f, 1080f, 12f)

    @Test fun letterboxIsExcludedAndCoordinatesUseActualViewport() {
        val viewport = scene().viewport
        assertFalse(viewport.contains(ControlPoint(.05f, .3f)))
        val point = viewport.local(ControlPoint(.5f, .3f))
        assertEquals(.5f, point.x, .0001f)
        assertEquals(.3f, point.y, .0001f)
    }
    @Test fun tapsActivateOnlyTheirOriginalTarget() {
        val g = gesture()
        assertEquals("tap", g.finish(ControlPoint(.405f, .303f), scene(), 120)?.action)
        assertNull(gesture().finish(ControlPoint(.9f, .3f), scene(), 120))
    }
    @Test fun movedTargetOrNewModalCannotReceiveOldTap() {
        assertNull(gesture().finish(ControlPoint(.4f, .3f), scene().copy(epoch = "session:2"), 100))
        assertNull(gesture().finish(ControlPoint(.4f, .3f), scene().copy(targets = emptyList()), 100))
        assertNull(gesture().finish(ControlPoint(.4f, .3f), scene(target = row.copy(rect = TouchRect(.7f, .7f, .1f, .1f))), 100))
    }
    @Test fun overlayWinsHitTestingAndBlocksUnderlyingTap() {
        val modal = row.copy(id = "modal")
        val latest = scene().copy(targets = listOf(row, modal))
        assertEquals("modal", latest.hit(ControlPoint(.4f, .3f))?.id)
        assertNull(gesture().finish(ControlPoint(.4f, .3f), latest, 100))
    }
    @Test fun verticalListDragScrollsWithoutConfirmingReleaseRow() {
        val g = gesture()
        val scroll = g.move(ControlPoint(.4f, .1f))!!
        assertEquals("scroll", scroll.action); assertTrue(scroll.value > 0)
        assertNull(g.finish(ControlPoint(.4f, .1f), scene(), 400))
    }
    @Test fun sliderUsesHorizontalDragButStillAllowsVerticalScrolling() {
        val s = scene(target = row.copy(kind = "slider"))
        assertEquals("adjust", gesture(s).move(ControlPoint(.7f, .3f))?.action)
        assertEquals("scroll", gesture(s).move(ControlPoint(.4f, .05f))?.action)
    }
    @Test fun axisIsLockedOnceGestureStarts() {
        val s = scene(target = row.copy(kind = "slider"))
        val g = gesture(s)
        assertEquals("adjust", g.move(ControlPoint(.5f, .3f))?.action)
        assertEquals("adjust", g.move(ControlPoint(.5f, .05f))?.action)
    }
    @Test fun chapterAndJournalSwipesNeverConfirm() {
        for (kind in listOf("chapters", "journal")) {
            val s = scene(kind)
            val result = gesture(s).finish(ControlPoint(.2f, .3f), s, 300)!!
            assertEquals("swipe", result.action); assertEquals(1f, result.value, 0f)
            assertEquals("swipeY", gesture(s).finish(ControlPoint(.4f, .6f), s, 300)?.action)
        }
    }
    @Test fun fileCardsAcceptHorizontalAndVerticalSwipes() {
        val s = scene("cards")
        assertEquals("swipe", gesture(s).finish(ControlPoint(.4f, .1f), s, 300)?.action)
        assertEquals("swipe", gesture(s).finish(ControlPoint(.1f, .3f), s, 300)?.action)
    }
    @Test fun dialogueDragsAndLongHoldsNeverAdvanceOrSkip() {
        val s = scene("continue")
        assertNull(gesture(s).finish(ControlPoint(.7f, .3f), s, 200))
        assertNull(gesture(s).finish(ControlPoint(.4f, .3f), s, 2000))
        assertEquals("tap", gesture(s).finish(ControlPoint(.4f, .3f), s, 100)?.action)
    }
    @Test fun textAndNumberTargetsOpenKeyboardRatherThanSendConfirm() {
        for (kind in listOf("text", "number")) {
            val s = scene("text", row.copy(kind = kind))
            assertEquals("keyboard", gesture(s).finish(ControlPoint(.4f, .3f), s, 100)?.action)
        }
    }
    @Test fun coalescedSwipeIsRecognizedOnRelease() {
        val s = scene("journal")
        assertEquals(-1f, gesture(s).finish(ControlPoint(.8f, .3f), s, 300)!!.value, 0f)
    }
    @Test fun chapterSwipeFiresBeforeFingerUpAndOnlyOnce() {
        val s = scene("chapters")
        val g = gesture(s)
        assertEquals("swipeY", g.move(ControlPoint(.4f, .27f))?.action)
        assertNull(g.move(ControlPoint(.4f, .1f)))
        assertNull(g.finish(ControlPoint(.4f, .1f), s, 3000))
    }
    @Test fun smallMenuDragIsResponsiveAndMainMenuScrollsToo() {
        for (kind in listOf("menu", "main")) {
            val s = scene(kind)
            assertEquals("scroll", gesture(s).move(ControlPoint(.4f, .26f))?.action)
        }
    }
    @Test fun malformedGeometryIsRejected() {
        assertFalse(TouchRect(0f, 0f, Float.NaN, 1f).valid)
        assertFalse(TouchRect(0f, 0f, 1f, 0f).valid)
    }
    @Test fun directProfileKeepsBackAndRemovesRedundantControls() {
        val state = ControlState(ControlMode.PAUSE, touch = scene())
        val direct = ControlProfile.forState(state, true, true, direct = true)
        assertFalse(direct.directions); assertFalse(direct.stick); assertTrue(direct.actions.isEmpty())
        assertEquals(ControlIcon.PLAY, direct.top?.icon)
        val fallback = ControlProfile.forState(state, true, true)
        assertTrue(fallback.directions); assertFalse(fallback.actions.isEmpty())
    }
}
