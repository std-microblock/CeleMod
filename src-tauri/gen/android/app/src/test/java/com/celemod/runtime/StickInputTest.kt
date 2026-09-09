package com.celemod.runtime

import org.junit.Assert.*
import org.junit.Test

class StickInputTest {
    private val neutral = ControlPoint(0f, 0f)
    private val area = ControlBounds(10f, 100f, 500f, 600f)

    @Test fun deadZoneDefaultsAndBoundsAreSafe() {
        assertEquals(.18f, ControlStyle().stickDeadZone)
        assertEquals(.18f, ControlStyle(stickDeadZone = Float.NaN).normalized().stickDeadZone)
        assertEquals(.18f, StickInput.deadZone(Float.POSITIVE_INFINITY))
        assertEquals(0f, StickInput.deadZone(-1f))
        assertEquals(.9f, StickInput.deadZone(1f))
    }

    @Test fun deadZoneAppliesRadiallyAtEveryConfiguredRatio() {
        for (percent in 1..90) {
            val ratio = percent / 100f
            assertEquals(neutral, StickInput.vector(ratio * .99f, 0f, ratio))
            assertEquals(neutral, StickInput.vector(ratio * .5f, ratio * .5f, ratio))
            assertEquals(ControlPoint(ratio, 0f), StickInput.vector(ratio, 0f, ratio))
            assertNotEquals(neutral, StickInput.vector(0f, -ratio * 1.01f, ratio))
        }
    }

    @Test fun zeroDeadZoneKeepsCenterNeutralAndOuterMotionIsClamped() {
        assertEquals(neutral, StickInput.vector(0f, 0f, 0f))
        assertEquals(ControlPoint(.001f, 0f), StickInput.vector(.001f, 0f, 0f))
        assertEquals(ControlPoint(1f, 0f), StickInput.vector(5f, 0f, .9f))
        val diagonal = StickInput.vector(3f, 4f, .18f)
        assertEquals(.6f, diagonal.x, .00001f); assertEquals(.8f, diagonal.y, .00001f)
        assertEquals(neutral, StickInput.vector(Float.NaN, 1f, .18f))
    }

    @Test fun deadZoneFeedbackOnlyFiresWhenReturningFromAnActiveDirection() {
        val feedback = StickDirectionFeedback()
        fun move(x: Float) {
            val point = StickInput.vector(x, 0f, .3f)
            feedback.update(StickDirection.fromVector(point.x, point.y))
        }
        move(0f); assertFalse(feedback.enteredDeadZone)
        move(.2f); assertFalse(feedback.enteredDeadZone)
        move(.7f); assertFalse(feedback.enteredDeadZone)
        move(.1f); assertTrue(feedback.enteredDeadZone)
        repeat(5) { move(0f); assertFalse(feedback.enteredDeadZone) }
        move(-.8f); move(0f); assertTrue(feedback.enteredDeadZone)
        feedback.clear(); assertFalse(feedback.enteredDeadZone)
        move(0f); assertFalse(feedback.enteredDeadZone)
        move(.8f); feedback.clear(); assertFalse(feedback.enteredDeadZone)
    }

    @Test fun deadZoneVibrationIsIndependentAndPreservesFineStrengths() {
        assertEquals(0, ControlStyle().deadZoneVibrationStrength())
        for (strength in 0..100) {
            val style = ControlStyle(stickDeadZoneVibration = true, stickDeadZoneStrength = strength)
            assertEquals(strength, style.deadZoneVibrationStrength())
            assertEquals(0, style.stickVibrationStrength(StickDirection.UP))
            assertEquals(0, style.vibrationStrength(true))
        }
        assertEquals(100, ControlStyle(stickDeadZoneVibration = true, stickDeadZoneStrength = 999).normalized().deadZoneVibrationStrength())
    }

    @Test fun floatingAreaUsesLeftHalfBelowToolbarIncludingSafeInsets() {
        assertEquals(ControlBounds(10f, 100f, 500f, 600f),
            StickInput.floatingArea(ControlBounds(10f, 20f, 990f, 600f), ControlBounds(0f, 0f, 300f, 100f)))
        val tiny = StickInput.floatingArea(ControlBounds(10f, 20f, 30f, 40f), ControlBounds(0f, 0f, 50f, 100f))
        assertEquals(0f, tiny.height)
        assertFalse(StickInput.contains(tiny, ControlPoint(15f, 40f)))
    }

    @Test fun floatingStickAppearsExactlyAtTouchDownAndStartsNeutral() {
        val gesture = StickGesture()
        for (point in listOf(ControlPoint(10f, 100f), ControlPoint(250f, 350f), ControlPoint(499f, 599f))) {
            assertTrue(gesture.begin(7, point, null, area, 80f))
            assertEquals(point, gesture.center)
            assertEquals(neutral, gesture.vector(point, 80f, 0f))
            assertEquals(ControlPoint(.5f, 0f), gesture.vector(ControlPoint(point.x + 40f, point.y), 80f, .18f))
            assertEquals(point, gesture.center) // Dragging never slides the base.
            assertTrue(gesture.end(7)); assertNull(gesture.center); assertEquals(-1, gesture.pointer)
        }
    }

    @Test fun floatingStickRejectsOutsideStartsButContinuesDraggingOutsideArea() {
        val gesture = StickGesture()
        for (point in listOf(ControlPoint(9f, 200f), ControlPoint(200f, 99f), ControlPoint(500f, 200f), ControlPoint(200f, 600f)))
            assertFalse(gesture.begin(1, point, null, area, 80f))
        assertTrue(gesture.begin(1, ControlPoint(450f, 200f), null, area, 80f))
        assertEquals(ControlPoint(1f, 0f), gesture.vector(ControlPoint(700f, 200f), 80f, .18f))
        assertEquals(ControlPoint(450f, 200f), gesture.center)
    }

    @Test fun secondFingerCannotRecenterOrReleaseTheStick() {
        val gesture = StickGesture()
        val point = ControlPoint(200f, 300f)
        assertTrue(gesture.begin(1, point, null, area, 80f))
        assertFalse(gesture.begin(2, ControlPoint(400f, 500f), null, area, 80f))
        assertFalse(gesture.end(2)); assertEquals(1, gesture.pointer); assertEquals(point, gesture.center)
        gesture.clear(); assertEquals(-1, gesture.pointer); assertNull(gesture.center)
        assertEquals(neutral, gesture.vector(point, 80f, .18f))
        assertTrue(gesture.begin(2, ControlPoint(300f, 400f), null, area, 80f))
    }

    @Test fun fixedStickKeepsSavedAnchorAndExistingHitRadius() {
        val gesture = StickGesture()
        val anchor = ControlPoint(600f, 500f) // Fixed sticks are not restricted to the floating area.
        assertFalse(gesture.begin(1, ControlPoint(800f, 500f), anchor, area, 100f))
        assertTrue(gesture.begin(1, ControlPoint(650f, 500f), anchor, area, 100f))
        assertEquals(anchor, gesture.center)
        assertEquals(ControlPoint(.5f, 0f), gesture.vector(ControlPoint(650f, 500f), 100f, .18f))
        gesture.end(1); assertEquals(ControlPoint(600f, 500f), anchor)
    }

    @Test fun invalidGeometryNeverCapturesOrGeneratesMovement() {
        val gesture = StickGesture()
        assertFalse(gesture.begin(1, ControlPoint(200f, 300f), null, area, 0f))
        assertFalse(gesture.begin(1, ControlPoint(Float.NaN, 300f), null, area, 80f))
        assertFalse(gesture.begin(-1, ControlPoint(200f, 300f), null, area, 80f))
        assertTrue(gesture.begin(1, ControlPoint(200f, 300f), null, area, 80f))
        assertEquals(neutral, gesture.vector(ControlPoint(220f, 300f), 0f, .18f))
    }

    @Test fun newSettingsRoundTripAndShareDraftSaveCancelReset() {
        val original = mapOf("game/stick" to ControlStyle())
        val positions = mapOf("game/stick" to ControlPoint(.25f, .75f))
        val draft = ControlLayoutDraft(positions, original)
        val settings = ControlStyle(directionMode = DirectionControlMode.FLOATING_STICK,
            stickDeadZone = .43f, stickDeadZoneVibration = true, stickDeadZoneStrength = 73)
        draft.setStyle("game/stick", settings)
        assertEquals(settings, ControlStyle.decode(ControlStyle.encode(draft.styleSnapshot()))["game/stick"])
        assertEquals(positions, draft.snapshot()); assertEquals(ControlStyle(), original["game/stick"])
        draft.reset(); assertEquals(ControlStyle(), draft.style("game/stick"))
        assertEquals(original, ControlLayoutDraft(positions, original).styleSnapshot())
        assertTrue(DirectionControlMode.FLOATING_STICK.buttonIds("game").isEmpty())
    }

    @Test fun legacyStylesKeep18PercentAndNoDeadZoneVibration() {
        for (raw in listOf("v1\ngame/stick=1,HOLD",
            "v2\ngame/stick=1,HOLD,1,false,false,50,50,STICK",
            "v2\ngame/stick=1,HOLD,1,false,false,50,50,STICK,RELEASE",
            "v2\ngame/stick=1,HOLD,1,false,false,50,50,STICK,RELEASE,true,true,70,30")) {
            val style = ControlStyle.decode(raw).getValue("game/stick")
            assertEquals(.18f, style.stickDeadZone); assertFalse(style.stickDeadZoneVibration)
        }
        val corrupt = ControlStyle.decode("v2\ngame/stick=1,HOLD,1,false,false,50,50,FLOATING_STICK,RELEASE,true,true,70,30,NaN,invalid,999")
            .getValue("game/stick")
        assertEquals(.18f, corrupt.stickDeadZone); assertFalse(corrupt.stickDeadZoneVibration)
        assertEquals(100, corrupt.stickDeadZoneStrength)
    }
}
