package com.celemod.runtime

import org.junit.Assert.*
import org.junit.Test

class ControlStyleTest {
    @Test fun oldLayoutsKeepOriginalSizeAndHoldBehavior() {
        assertTrue(ControlStyle.decode(null).isEmpty())
        assertEquals(ControlStyle(1f, ControlSlideBehavior.HOLD), ControlLayoutDraft(emptyMap()).style("game/action/Jump"))
    }
    @Test fun stylesRoundTripIndependentlyForEachControl() {
        val saved = mapOf("game/action/Jump" to ControlStyle(1.5f, ControlSlideBehavior.TRANSFER),
            "game/action/Grab" to ControlStyle(.75f, ControlSlideBehavior.ADDITIVE),
            "game/stick" to ControlStyle(2f), "menu/action/0" to ControlStyle(1.25f))
        assertEquals(saved, ControlStyle.decode(ControlStyle.encode(saved)))
    }
    @Test fun malformedStylesDoNotBreakOtherControls() {
        assertTrue(ControlStyle.decode("v2\ngame/stick=1,HOLD").isEmpty())
        assertTrue(ControlStyle.decode("v1\n" + "x".repeat(65536)).isEmpty())
        val loaded = ControlStyle.decode("v1\ngame/stick=NaN,HOLD\nbad?=1,HOLD\ngame/action/Jump=9,UNKNOWN\nmenu/action/0=-2,TRANSFER")
        assertEquals(2, loaded.size)
        assertEquals(ControlStyle(2f, ControlSlideBehavior.HOLD), loaded["game/action/Jump"])
        assertEquals(ControlStyle(.5f, ControlSlideBehavior.TRANSFER), loaded["menu/action/0"])
        assertEquals(1f, ControlStyle(Float.POSITIVE_INFINITY).normalized().scale)
    }
    @Test fun sizeAndBehaviorShareSaveCancelAndResetWithPositions() {
        val positions = mapOf("game/action/Jump" to ControlPoint(.8f, .8f))
        val styles = mapOf("game/action/Jump" to ControlStyle(1.25f))
        val draft = ControlLayoutDraft(positions, styles)
        draft.setStyle("game/action/Jump", ControlStyle(1.75f, ControlSlideBehavior.ADDITIVE))
        draft.move("game/action/Jump", ControlPoint(.6f, .6f))
        assertEquals(ControlStyle(1.25f), styles["game/action/Jump"])
        assertEquals(ControlPoint(.8f, .8f), positions["game/action/Jump"])
        val saved = draft.styleSnapshot()
        draft.reset()
        assertTrue(draft.snapshot().isEmpty()); assertTrue(draft.styleSnapshot().isEmpty())
        assertEquals(ControlStyle(1.75f, ControlSlideBehavior.ADDITIVE), saved["game/action/Jump"])
        assertEquals(styles, ControlLayoutDraft(positions, styles).styleSnapshot())
    }
    @Test fun transferReleasesOutsideAndActivatesOnlyCurrentButton() {
        val gesture = ActionSlideGesture("A", ControlSlideBehavior.TRANSFER)
        assertEquals(setOf("A"), gesture.active())
        gesture.move("B"); assertEquals(setOf("B"), gesture.active())
        gesture.move(null); assertTrue(gesture.active().isEmpty())
        gesture.move("A"); assertEquals(setOf("A"), gesture.active())
    }
    @Test fun additiveKeepsCrossedButtonsUntilThatFingerIsReleased() {
        val gesture = ActionSlideGesture("A", ControlSlideBehavior.ADDITIVE)
        gesture.move("B"); assertEquals(setOf("A", "B"), gesture.active())
        gesture.move(null); assertEquals(setOf("A", "B"), gesture.active())
        gesture.move("C"); gesture.move("B")
        assertEquals(setOf("A", "B", "C"), gesture.active())
        // A returned snapshot cannot mutate ownership.
        val snapshot = gesture.active()
        gesture.move("D"); assertFalse("D" in snapshot)
    }
    @Test fun holdNeverActivatesAnotherButtonOrDropsOriginalWhileDrifting() {
        val gesture = ActionSlideGesture("A", ControlSlideBehavior.HOLD)
        gesture.move("B"); gesture.move(null); gesture.move("C")
        assertEquals(setOf("A"), gesture.active())
    }
    @Test fun fingersRemainIndependentIncludingWhenTheyShareAButton() {
        val fingers = mutableMapOf(1 to ActionSlideGesture("A", ControlSlideBehavior.ADDITIVE),
            2 to ActionSlideGesture("B", ControlSlideBehavior.TRANSFER))
        fun active() = fingers.values.flatMap { it.active() }.toSet()
        fingers[1]!!.move("B"); fingers[2]!!.move("C")
        assertEquals(setOf("A", "B", "C"), active())
        fingers.remove(2); assertEquals(setOf("A", "B"), active())
        fingers.clear(); assertTrue(active().isEmpty())
    }
    @Test fun enlargedControlsRemainInsideSafeBoundsAndOutsideToolbar() {
        val bounds = ControlBounds(10f, 10f, 1010f, 610f)
        val toolbar = ControlBounds(0f, 0f, 300f, 100f)
        val half = 50f * ControlStyle(2f).normalized().scale
        val point = ControlLayout.constrain(ControlPoint(25f, 25f), half, half, bounds, toolbar)
        assertTrue(point.x - half >= bounds.left && point.x + half <= bounds.right)
        assertTrue(point.y - half >= bounds.top && point.y + half <= bounds.bottom)
        assertTrue(point.x - half >= toolbar.right || point.y - half >= toolbar.bottom)
    }
}
