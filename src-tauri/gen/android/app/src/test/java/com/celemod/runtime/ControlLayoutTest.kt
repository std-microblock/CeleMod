package com.celemod.runtime

import org.junit.Assert.*
import org.junit.Test

class ControlLayoutTest {
    private val bounds = ControlBounds(10f, 10f, 1010f, 610f)
    private val toolbar = ControlBounds(0f, 0f, 250f, 100f)

    @Test fun positionsSurviveSerialization() {
        val positions = mapOf("game/stick" to ControlPoint(.17f, .8f), "game/action/Jump" to ControlPoint(.8f, .75f),
            "menu/action/0" to ControlPoint(.65f, .6f), "shared/top" to ControlPoint(.92f, .12f))
        assertEquals(positions, ControlLayout.decode(ControlLayout.encode(positions)))
    }
    @Test fun damagedOrFuturePreferencesSafelyUseDefaults() {
        assertTrue(ControlLayout.decode(null).isEmpty())
        assertTrue(ControlLayout.decode("v2\ngame/stick=.2,.3").isEmpty())
        assertTrue(ControlLayout.decode("v1\ngame/stick=NaN,.2\nshared/top=Infinity,0\nbad?=.2,.3\ngame/action/Jump=oops,.3").isEmpty())
        assertEquals(mapOf("game/stick" to ControlPoint(.2f, .3f)),
            ControlLayout.decode("v1\nmalformed\ngame/stick=.2,.3"))
    }
    @Test fun loadedCoordinatesAreClamped() {
        assertEquals(ControlPoint(0f, 1f), ControlLayout.decode("v1\ngame/stick=-5,8")["game/stick"])
    }
    @Test fun draftDoesNotChangeSavedPositionsUntilExplicitSave() {
        val saved = mapOf("game/stick" to ControlPoint(.2f, .8f))
        val draft = ControlLayoutDraft(saved)
        draft.move("game/stick", ControlPoint(.4f, .6f))
        assertEquals(ControlPoint(.2f, .8f), saved["game/stick"])
        assertEquals(ControlPoint(.4f, .6f), draft.snapshot()["game/stick"])
        val nextSession = ControlLayoutDraft(saved) // Cancel discards the draft.
        assertEquals(saved, nextSession.snapshot())
    }
    @Test fun resetCanBeCancelledAndRestoredAfterSaving() {
        val saved = mapOf("menu/action/0" to ControlPoint(.7f, .7f))
        val draft = ControlLayoutDraft(saved)
        draft.reset()
        assertTrue(draft.snapshot().isEmpty())
        assertFalse(saved.isEmpty())
        assertTrue(ControlLayout.decode(ControlLayout.encode(draft.snapshot())).isEmpty())
        assertEquals(saved, ControlLayoutDraft(saved).snapshot())
    }
    @Test fun cancelledDragRestoresPreviousCustomOrDefaultPosition() {
        val draft = ControlLayoutDraft(mapOf("shared/top" to ControlPoint(.8f, .2f)))
        val original = draft.get("shared/top")
        draft.move("shared/top", ControlPoint(.4f, .3f))
        draft.restore("shared/top", original)
        assertEquals(original, draft.get("shared/top"))
        draft.move("game/stick", ControlPoint(.3f, .5f))
        draft.restore("game/stick", null)
        assertNull(draft.get("game/stick"))
    }
    @Test fun saveSnapshotIsNotChangedByLaterDraftEdits() {
        val draft = ControlLayoutDraft(emptyMap())
        draft.move("game/stick", ControlPoint(.2f, .8f))
        val snapshot = draft.snapshot()
        draft.reset()
        assertEquals(ControlPoint(.2f, .8f), snapshot["game/stick"])
        draft.move("game/stick", ControlPoint(Float.NaN, .5f))
        assertNull(draft.get("game/stick"))
    }
    @Test fun normalizedPositionsScaleWithSafeViewport() {
        val original = ControlPoint(510f, 460f)
        val normalized = ControlLayout.normalize(original, bounds)
        assertEquals(ControlPoint(.5f, .75f), normalized)
        assertEquals(original, ControlLayout.project(normalized, bounds))
        assertEquals(ControlPoint(1030f, 925f), ControlLayout.project(normalized, ControlBounds(30f, 25f, 2030f, 1225f)))
    }
    @Test fun buttonsAndStickRemainEntirelyOnScreen() {
        val key = ControlLayout.constrain(ControlPoint(1500f, 900f), 40f, 40f, bounds, toolbar)
        assertEquals(ControlPoint(970f, 570f), key)
        val stick = ControlLayout.constrain(ControlPoint(-100f, 1000f), 100f, 100f, bounds, toolbar)
        assertEquals(ControlPoint(110f, 510f), stick)
    }
    @Test fun toolbarCannotBeCoveredByDraggedControls() {
        val point = ControlLayout.constrain(ControlPoint(80f, 50f), 40f, 40f, bounds, toolbar)
        assertTrue(point.x - 40f >= toolbar.right || point.y - 40f >= toolbar.bottom)
        val nearRight = ControlLayout.constrain(ControlPoint(240f, 50f), 40f, 40f, bounds, toolbar)
        assertEquals(290f, nearRight.x, .001f)
    }
    @Test fun smallViewportsDoNotThrow() {
        val small = ControlBounds(10f, 10f, 10f, 10f)
        assertEquals(ControlPoint(10f, 10f), ControlLayout.constrain(ControlPoint(100f, 100f), 70f, 70f, small, toolbar))
        assertEquals(ControlPoint(.5f, .5f), ControlLayout.normalize(ControlPoint(10f, 10f), small))
    }
    @Test fun gameAndMenuPositionsAreIndependentButPausePositionIsShared() {
        val draft = ControlLayoutDraft(emptyMap())
        draft.move("game/action/Jump", ControlPoint(.8f, .6f))
        draft.move("menu/action/0", ControlPoint(.7f, .8f))
        draft.move("shared/top", ControlPoint(.9f, .15f))
        assertEquals(3, draft.snapshot().size)
        assertNotEquals(draft.get("game/action/Jump"), draft.get("menu/action/0"))
        assertEquals(ControlPoint(.9f, .15f), draft.get("shared/top"))
    }
}
