package com.celemod.runtime

data class ModButton(val id: String, val label: String, val code: Int, val available: Boolean, val icon: ControlIcon = ControlIcon.NONE)

object ModButtons {
    fun visible(mode: ControlMode) = mode !in setOf(ControlMode.LOADING, ControlMode.TRANSITION,
        ControlMode.NAMING, ControlMode.SEARCH, ControlMode.CHAT)
    fun held(buttons: List<ModButton>, codes: Set<Int>) = buttons
        .filter { it.available && it.code in codes }.map { it.id }.distinct().sorted()
}
