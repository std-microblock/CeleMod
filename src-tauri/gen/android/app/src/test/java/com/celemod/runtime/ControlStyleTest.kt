package com.celemod.runtime

import org.junit.Assert.*
import org.junit.Test

class ControlStyleTest {
    @Test fun oldLayoutsKeepOriginalSizeAndHoldBehavior() {
        assertTrue(ControlStyle.decode(null).isEmpty())
        assertEquals(ControlStyle(1f, ControlSlideBehavior.HOLD), ControlLayoutDraft(emptyMap()).style("game/action/Jump"))
        assertEquals(mapOf("game/stick" to ControlStyle(1.5f, ControlSlideBehavior.TRANSFER)),
            ControlStyle.decode("v1\ngame/stick=1.5,TRANSFER"))
    }
    @Test fun opacityFeedbackAndDirectionModeRoundTrip() {
        val saved = mapOf("game/stick" to ControlStyle(directionMode = DirectionControlMode.EIGHT_BUTTONS),
            "game/action/Jump" to ControlStyle(.75f, ControlSlideBehavior.ADDITIVE, .35f, true, true, 80, 25),
            "game/dpad/UpLeft" to ControlStyle(opacity = 0f, leaveVibration = true, leaveStrength = 100),
            "menu/action/0" to ControlStyle(enterVibration = true, enterStrength = 0))
        assertEquals(saved, ControlStyle.decode(ControlStyle.encode(saved)))
        assertTrue(ControlStyle.decode("v3\ngame/stick=1,HOLD").isEmpty())
    }
    @Test fun newValuesAreClampedAndMalformedFieldsUseSafeDefaults() {
        val loaded = ControlStyle.decode("v2\ngame/stick=1,HOLD,NaN,invalid,true,-10,900,UNKNOWN\n" +
            "game/action/Jump=1,TRANSFER,-2,true,false,broken,broken,DEFAULT")
        assertEquals(ControlStyle(leaveVibration = true, enterStrength = 0, leaveStrength = 100), loaded["game/stick"])
        assertEquals(ControlStyle(slide = ControlSlideBehavior.TRANSFER, opacity = 0f, enterVibration = true), loaded["game/action/Jump"])
        assertEquals(1f, ControlStyle(opacity = 5f).normalized().opacity)
        assertEquals(1f, ControlStyle(opacity = Float.POSITIVE_INFINITY).normalized().opacity)
    }
    @Test fun newSettingsAreDraftOnlyUntilSavedAndResetIsUndoable() {
        val original = mapOf("game/stick" to ControlStyle(directionMode = DirectionControlMode.STICK))
        val draft = ControlLayoutDraft(emptyMap(), original)
        val changed = ControlStyle(opacity = .2f, enterVibration = true, leaveVibration = true,
            enterStrength = 70, leaveStrength = 30, directionMode = DirectionControlMode.FOUR_BUTTONS)
        draft.setStyle("game/stick", changed)
        assertEquals(DirectionControlMode.STICK, original["game/stick"]?.directionMode)
        val saved = ControlStyle.decode(ControlStyle.encode(draft.styleSnapshot()))
        draft.reset()
        assertEquals(ControlStyle(), draft.style("game/stick"))
        assertEquals(changed, saved["game/stick"])
        assertEquals(original, ControlLayoutDraft(emptyMap(), original).styleSnapshot())
    }
    @Test fun vibrationSwitchesAndZeroStrengthAreIndependent() {
        assertEquals(0, ControlStyle().vibrationStrength(true))
        assertEquals(0, ControlStyle().vibrationStrength(false))
        val style = ControlStyle(enterVibration = true, leaveVibration = true, enterStrength = 70, leaveStrength = 20)
        assertEquals(70, style.vibrationStrength(true)); assertEquals(20, style.vibrationStrength(false))
        assertEquals(0, style.copy(enterVibration = false).vibrationStrength(true))
        assertEquals(0, style.copy(leaveStrength = 0).vibrationStrength(false))
    }
    @Test fun elevenPresetsAndAll101FineStrengthLevelsRemainDistinctAfterSaving() {
        assertEquals((0..100 step 10).toList(), ControlStyle.strengthPresets)
        assertEquals(11, ControlStyle.strengthPresets.size)
        for (strength in 0..100) {
            val style = ControlStyle(enterVibration = true, leaveVibration = true,
                enterStrength = strength, leaveStrength = 100 - strength)
            val saved = ControlStyle.decode(ControlStyle.encode(mapOf("game/action/Jump" to style))).getValue("game/action/Jump")
            assertEquals(strength, saved.vibrationStrength(true))
            assertEquals(100 - strength, saved.vibrationStrength(false))
        }
    }
    @Test fun contactsFireOnEnterLeaveAndReentryButNotStationaryMoves() {
        val contacts = ControlContacts()
        assertEquals(listOf(ControlContacts.Change("A", true)), contacts.update(setOf("A")))
        repeat(10) { assertTrue(contacts.update(setOf("A")).isEmpty()) }
        assertEquals(listOf(ControlContacts.Change("A", false), ControlContacts.Change("B", true)), contacts.update(setOf("B")))
        assertEquals(listOf(ControlContacts.Change("B", false)), contacts.update(emptySet()))
        assertEquals(listOf(ControlContacts.Change("A", true)), contacts.update(setOf("A")))
    }
    @Test fun lastContactLeavesAndCancellationDoesNotEmitFeedback() {
        val contacts = ControlContacts()
        contacts.update(listOf("A", "A", "B").toSet())
        assertTrue(contacts.update(listOf("A", "B").toSet()).isEmpty())
        assertEquals(listOf(ControlContacts.Change("A", false)), contacts.update(setOf("B")))
        contacts.clear() // Focus loss, scene switch, editor and ACTION_CANCEL are silent.
        assertTrue(contacts.update(emptySet()).isEmpty())
        assertEquals(listOf(ControlContacts.Change("B", true)), contacts.update(setOf("B")))
    }
    @Test fun contactFeedbackDoesNotChangeLatchedActionOwnership() {
        for (behavior in listOf(ControlSlideBehavior.HOLD, ControlSlideBehavior.ADDITIVE)) {
            val gesture = ActionSlideGesture("A", behavior)
            val contacts = ControlContacts()
            contacts.update(setOf("A")); gesture.move(null)
            assertEquals(listOf(ControlContacts.Change("A", false)), contacts.update(emptySet()))
            assertEquals(setOf("A"), gesture.active())
        }
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
        assertEquals(ControlStyle(3f, ControlSlideBehavior.HOLD), loaded["game/action/Jump"])
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
    @Test fun tripleSizeControlsMayOverlapToolbarAndExtendPastScreenEdges() {
        val bounds = ControlBounds(10f, 10f, 1010f, 610f)
        val half = 50f * ControlStyle(3f).normalized().scale
        val point = ControlLayout.constrain(ControlPoint(25f, 25f), bounds)
        assertEquals(ControlPoint(25f, 25f), point)
        assertTrue(point.x - half < bounds.left && point.y - half < bounds.top)
    }

    @Test fun ringDisplayAndTripleSizeRoundTripForFixedAndFloatingSticks() {
        for (mode in listOf(DirectionControlMode.STICK, DirectionControlMode.FLOATING_STICK)) {
            val saved = mapOf("game/stick" to ControlStyle(scale = 3f, directionMode = mode,
                stickDisplay = StickDisplayMode.RING, stickDeadZone = .3f))
            assertEquals(saved, ControlStyle.decode(ControlStyle.encode(saved)))
        }
        assertEquals(StickDisplayMode.CLASSIC, StickDisplayMode.parse("unknown"))
        assertEquals(StickDisplayMode.CLASSIC, ControlStyle.decode("v1\ngame/stick=2,HOLD").getValue("game/stick").stickDisplay)
        assertEquals(3f, ControlStyle(10f).normalized().scale)
    }

    @Test fun mergedEditsChangeOnlyEditedFieldsAndSelectedScope() {
        val source = ControlStyle(scale = 1f, opacity = .5f)
        val other = ControlStyle(scale = 2f, opacity = .8f, slide = ControlSlideBehavior.ADDITIVE,
            directionMode = DirectionControlMode.EIGHT_BUTTONS, enterStrength = 70)
        val draft = ControlLayoutDraft(emptyMap(), mapOf("a" to source, "b" to other, "menu" to other))
        draft.applyStyles(listOf("a", "b"), source, source.copy(scale = 3f, leaveVibration = true))
        assertEquals(source.copy(scale = 3f, leaveVibration = true), draft.style("a"))
        assertEquals(other.copy(scale = 3f, leaveVibration = true), draft.style("b"))
        assertEquals(other, draft.style("menu"))
    }
}
