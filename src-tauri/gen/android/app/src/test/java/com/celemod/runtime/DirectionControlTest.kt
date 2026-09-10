package com.celemod.runtime

import org.junit.Assert.*
import org.junit.Test

class DirectionControlTest {
    private val four = DirectionControlMode.FOUR_BUTTONS
    private val eight = DirectionControlMode.EIGHT_BUTTONS
    private val configured = ControlStyle(scale = 1.5f, opacity = .35f,
        enterVibration = true, leaveVibration = true, enterStrength = 83, leaveStrength = 27,
        directionSlide = DirectionSlideBehavior.KEEP_LAST)

    @Test fun groupsContainExactlyTheIntendedDirectionButtons() {
        assertEquals(setOf("game/dpad/Left", "game/dpad/Down", "game/dpad/Right", "game/dpad/Up"),
            four.buttonIds("game").toSet())
        assertEquals(8, eight.buttonIds("game").toSet().size)
        assertTrue(eight.buttonIds("game").containsAll(four.buttonIds("game")))
        assertEquals(4, eight.buttonIds("menu").size)
        assertTrue(DirectionControlMode.STICK.buttonIds("game").isEmpty())
    }

    @Test fun fourKeyBatchLeavesDiagonalsMenuActionsAndPositionsUntouched() {
        val positions = eight.buttonIds("game").associateWith { ControlPoint(.2f, .7f) }
        val untouched = mapOf("game/dpad/UpLeft" to ControlStyle(opacity = .6f),
            "game/stick" to ControlStyle(directionMode = eight),
            "game/action/Jump" to ControlStyle(scale = .7f), "menu/dpad/Up" to ControlStyle(scale = 1.2f))
        val draft = ControlLayoutDraft(positions, untouched)
        draft.setDirectionStyles("game", four, configured)
        four.buttonIds("game").forEach { assertEquals(configured, draft.style(it)) }
        untouched.forEach { (id, style) -> assertEquals(style, draft.style(id)) }
        assertEquals(positions, draft.snapshot())
        assertEquals(4 + untouched.size, draft.styleSnapshot().size)
    }

    @Test fun eightKeyBatchCopiesEverySettingToCardinalAndDiagonalButtons() {
        val draft = ControlLayoutDraft(emptyMap())
        draft.setDirectionStyles("game", eight, configured)
        assertEquals(eight.buttonIds("game").toSet(), draft.styleSnapshot().keys)
        eight.buttonIds("game").forEach { assertEquals(configured, draft.style(it)) }
        assertEquals(draft.styleSnapshot(), ControlStyle.decode(ControlStyle.encode(draft.styleSnapshot())))
    }

    @Test fun menuBatchStaysSeparateAndNeverCreatesMenuDiagonals() {
        val draft = ControlLayoutDraft(emptyMap(), mapOf("game/dpad/Up" to configured))
        draft.setDirectionStyles("menu", eight, ControlStyle(opacity = .2f))
        assertEquals(configured, draft.style("game/dpad/Up"))
        assertEquals(5, draft.styleSnapshot().size)
        four.buttonIds("menu").forEach { assertEquals(.2f, draft.style(it).opacity) }
    }

    @Test fun batchIsDraftOnlyAndResetCancelAndSingleEditsRemainIndependent() {
        val original = mapOf("game/dpad/Up" to ControlStyle(opacity = .8f))
        val draft = ControlLayoutDraft(emptyMap(), original)
        draft.setDirectionStyles("game", eight, configured)
        draft.setStyle("game/dpad/Up", configured.copy(opacity = .9f))
        assertEquals(.8f, original.getValue("game/dpad/Up").opacity)
        assertEquals(.35f, draft.style("game/dpad/Down").opacity)
        val saved = draft.styleSnapshot()
        draft.reset()
        assertTrue(draft.styleSnapshot().isEmpty())
        assertEquals(configured, saved["game/dpad/Down"])
        assertEquals(original, ControlLayoutDraft(emptyMap(), original).styleSnapshot())
    }

    @Test fun batchNormalizesValuesWithoutCopyingTheDirectionMode() {
        val original = mapOf("game/stick" to ControlStyle(directionMode = four))
        val draft = ControlLayoutDraft(emptyMap(), original)
        draft.setDirectionStyles("game", eight, configured.copy(scale = 9f, opacity = -1f,
            leaveStrength = 500, directionMode = eight))
        assertEquals(four, draft.style("game/stick").directionMode)
        eight.buttonIds("game").forEach {
            assertNull(draft.style(it).directionMode)
            assertEquals(3f, draft.style(it).scale)
            assertEquals(0f, draft.style(it).opacity)
            assertEquals(100, draft.style(it).leaveStrength)
        }
    }

    @Test fun missingOrUnknownOutsideBehaviorKeepsLegacyReleaseBehavior() {
        for (raw in listOf("v1\ngame/dpad/Up=1,HOLD",
            "v2\ngame/dpad/Up=1,HOLD,1,false,false,50,50,DEFAULT",
            "v2\ngame/dpad/Up=1,HOLD,1,false,false,50,50,DEFAULT,UNKNOWN")) {
            assertEquals(DirectionSlideBehavior.RELEASE,
                ControlStyle.decode(raw).getValue("game/dpad/Up").directionSlide)
        }
        assertEquals(configured, ControlStyle.decode(ControlStyle.encode(mapOf("game/dpad/Up" to configured)))["game/dpad/Up"])
    }

    @Test fun releaseModeReleasesOutsideAndAllowsReentryOrAnotherDirection() {
        val gesture = DirectionSlideGesture("Up", DirectionSlideBehavior.RELEASE)
        assertEquals("Up", gesture.active())
        gesture.move(null); assertNull(gesture.active())
        gesture.move("Up"); assertEquals("Up", gesture.active())
        gesture.move("Down"); assertEquals("Down", gesture.active())
        gesture.move(null); assertNull(gesture.active())
    }

    @Test fun keepLastRetainsOutsideButSwitchesRatherThanAccumulatingDirections() {
        val gesture = DirectionSlideGesture("UpLeft", DirectionSlideBehavior.KEEP_LAST)
        repeat(10) { gesture.move(null); assertEquals("UpLeft", gesture.active()) }
        gesture.move("Right"); assertEquals("Right", gesture.active())
        gesture.move(null); assertEquals("Right", gesture.active())
        assertEquals(setOf(22), ControlKeys.resolveAll(ControlState(), gesture.active()!!))
        gesture.move("DownRight")
        assertEquals(setOf(20, 22), ControlKeys.resolveAll(ControlState(), gesture.active()!!))
    }

    @Test fun eachFingerKeepsItsStartingPolicyAndSharedKeysHaveIndependentOwners() {
        val fingers = linkedMapOf(1 to DirectionSlideGesture("UpLeft", DirectionSlideBehavior.KEEP_LAST),
            2 to DirectionSlideGesture("Left", DirectionSlideBehavior.RELEASE))
        fun held() = fingers.values.mapNotNull { it.active() }.flatMap { ControlKeys.resolveAll(ControlState(), it) }.toSet()
        assertEquals(setOf(19, 21), held())
        fingers.getValue(1).move("Left")
        fingers.getValue(1).move(null); fingers.getValue(2).move(null)
        assertEquals(setOf(21), held())
        fingers.getValue(2).move("Right"); assertEquals(setOf(21, 22), held())
        fingers.remove(1); assertEquals(setOf(22), held())
        fingers.clear(); assertTrue(held().isEmpty())
    }

    @Test fun geometricLeaveFeedbackStillFiresWhileDirectionRemainsHeld() {
        val contacts = ControlContacts()
        val gesture = DirectionSlideGesture("Up", DirectionSlideBehavior.KEEP_LAST)
        contacts.update(setOf("Up")); gesture.move(null)
        assertEquals(listOf(ControlContacts.Change("Up", false)), contacts.update(emptySet()))
        assertEquals("Up", gesture.active())
        assertTrue(contacts.update(emptySet()).isEmpty())
    }
}
