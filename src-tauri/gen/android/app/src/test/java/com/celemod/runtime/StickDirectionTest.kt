package com.celemod.runtime

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.cos
import kotlin.math.sin

class StickDirectionTest {
    @Test fun allEightAnglesMatchTheActualInputBindings() {
        val expected = listOf(setOf("Right"), setOf("Right", "Down"), setOf("Down"),
            setOf("Left", "Down"), setOf("Left"), setOf("Left", "Up"), setOf("Up"), setOf("Right", "Up"))
        for (i in 0..7) {
            val angle = Math.toRadians(i * 45.0)
            val direction = StickDirection.fromVector(cos(angle).toFloat(), sin(angle).toFloat())!!
            assertEquals(expected[i], direction.bindings.toSet())
            assertEquals(i % 2 == 1, direction.diagonal)
        }
    }

    @Test fun feedbackUsesInputSectorsNotExactAngles() {
        assertEquals(StickDirection.RIGHT, StickDirection.fromVector(1f, .4f))
        assertEquals(StickDirection.DOWN_RIGHT, StickDirection.fromVector(1f, .42f))
        assertEquals(StickDirection.DOWN_RIGHT, StickDirection.fromVector(.42f, 1f))
        assertEquals(StickDirection.DOWN, StickDirection.fromVector(.4f, 1f))
        assertEquals(StickDirection.UP_LEFT, StickDirection.fromVector(-.7f, -1f))
        assertEquals(StickDirection.UP_LEFT, StickDirection.fromVector(-.07f, -.1f))
    }

    @Test fun neutralAndNonFiniteVectorsNeverPickADirection() {
        assertNull(StickDirection.fromVector(0f, 0f))
        assertNull(StickDirection.fromVector(Float.NaN, 1f))
        assertNull(StickDirection.fromVector(1f, Float.POSITIVE_INFINITY))
    }

    @Test fun unchangedDirectionAndMovementWithinItsSectorDoNotRepeat() {
        val feedback = StickDirectionFeedback()
        assertEquals(StickDirection.RIGHT, feedback.update(StickDirection.fromVector(1f, 0f)))
        repeat(10) { assertNull(feedback.update(StickDirection.fromVector(.9f, .1f))) }
        assertEquals(StickDirection.DOWN_RIGHT, feedback.update(StickDirection.fromVector(.9f, .5f)))
        assertNull(feedback.update(StickDirection.fromVector(.8f, .8f)))
    }

    @Test fun changesWithinTheSameCategoryStillTrigger() {
        val feedback = StickDirectionFeedback()
        for (direction in listOf(StickDirection.RIGHT, StickDirection.UP, StickDirection.LEFT,
            StickDirection.DOWN, StickDirection.DOWN_RIGHT, StickDirection.UP_RIGHT, StickDirection.UP_LEFT)) {
            assertEquals(direction, feedback.update(direction))
        }
    }

    @Test fun deadZoneAndReleaseResetSilentlyThenAllowReentry() {
        val feedback = StickDirectionFeedback()
        feedback.update(StickDirection.UP_LEFT)
        assertNull(feedback.update(null)) // The stick reports neutral inside its dead zone.
        assertNull(feedback.update(null))
        assertEquals(StickDirection.UP_LEFT, feedback.update(StickDirection.UP_LEFT))
        feedback.clear() // Lift, cancel, focus/scene change, layout editor.
        assertEquals(StickDirection.UP_LEFT, feedback.update(StickDirection.UP_LEFT))
    }

    @Test fun directionFeedbackSwitchesAndStrengthsAreIndependentOfContactFeedback() {
        val style = ControlStyle(stickDiagonalVibration = true, stickCardinalVibration = true,
            stickDiagonalStrength = 83, stickCardinalStrength = 27)
        for (direction in StickDirection.entries) {
            assertEquals(if (direction.diagonal) 83 else 27, style.stickVibrationStrength(direction))
            assertEquals(if (direction.diagonal) 0 else 27,
                style.copy(stickDiagonalVibration = false).stickVibrationStrength(direction))
            assertEquals(if (direction.diagonal) 83 else 0,
                style.copy(stickCardinalVibration = false).stickVibrationStrength(direction))
        }
        assertEquals(0, style.vibrationStrength(true)); assertEquals(0, style.vibrationStrength(false))
        assertEquals(0, ControlStyle(enterVibration = true, leaveVibration = true).stickVibrationStrength(StickDirection.RIGHT))
        assertEquals(0, style.copy(stickDiagonalStrength = 0).stickVibrationStrength(StickDirection.UP_LEFT))
        assertEquals(0, style.copy(stickCardinalStrength = 0).stickVibrationStrength(StickDirection.UP))
    }

    @Test fun bothGroupsPreserveAllFineStrengthLevelsAfterSaving() {
        for (strength in 0..100) {
            val style = ControlStyle(stickDiagonalVibration = true, stickCardinalVibration = true,
                stickDiagonalStrength = strength, stickCardinalStrength = 100 - strength)
            assertEquals(style, ControlStyle.decode(ControlStyle.encode(mapOf("game/stick" to style)))["game/stick"])
        }
    }

    @Test fun oldStylesKeepBothNewFeedbackGroupsDisabled() {
        for (raw in listOf("v1\ngame/stick=1,HOLD",
            "v2\ngame/stick=1,HOLD,1,false,false,50,50,STICK",
            "v2\ngame/stick=1,HOLD,1,false,false,50,50,STICK,RELEASE")) {
            val style = ControlStyle.decode(raw).getValue("game/stick")
            assertFalse(style.stickDiagonalVibration); assertFalse(style.stickCardinalVibration)
            assertEquals(50, style.stickDiagonalStrength); assertEquals(50, style.stickCardinalStrength)
        }
    }

    @Test fun malformedValuesFailSafelyAndStrengthsAreClamped() {
        val loaded = ControlStyle.decode("v2\ngame/stick=1,HOLD,1,false,false,50,50,STICK,RELEASE,invalid,true,-5,999")
            .getValue("game/stick")
        assertFalse(loaded.stickDiagonalVibration); assertTrue(loaded.stickCardinalVibration)
        assertEquals(0, loaded.stickDiagonalStrength); assertEquals(100, loaded.stickCardinalStrength)
        val malformed = ControlStyle.decode("v2\ngame/stick=1,HOLD,1,false,false,50,50,STICK,RELEASE,true,false,NaN,broken")
            .getValue("game/stick")
        assertEquals(50, malformed.stickDiagonalStrength); assertEquals(50, malformed.stickCardinalStrength)
        assertEquals(100, ControlStyle(stickDiagonalStrength = 999).normalized().stickDiagonalStrength)
        assertEquals(0, ControlStyle(stickCardinalStrength = -1).normalized().stickCardinalStrength)
    }

    @Test fun independentGroupsFollowDraftSaveCancelAndReset() {
        val original = mapOf("game/stick" to ControlStyle(stickCardinalVibration = true, stickCardinalStrength = 30))
        val draft = ControlLayoutDraft(emptyMap(), original)
        val modified = draft.style("game/stick").copy(stickDiagonalVibration = true, stickDiagonalStrength = 70)
        draft.setStyle("game/stick", modified)
        assertFalse(original.getValue("game/stick").stickDiagonalVibration)
        val saved = ControlStyle.decode(ControlStyle.encode(draft.styleSnapshot()))
        assertEquals(modified, saved["game/stick"])
        draft.reset(); assertEquals(ControlStyle(), draft.style("game/stick"))
        assertEquals(original, ControlLayoutDraft(emptyMap(), original).styleSnapshot())
    }
}
