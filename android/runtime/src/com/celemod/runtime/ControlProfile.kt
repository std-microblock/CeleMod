package com.celemod.runtime

/** Semantic actions, kept independent of View/SDL so profiles can be regression tested. */
enum class ControlMode {
    FALLBACK, LOADING, GAMEPLAY, PAUSE, PAUSE_MENU, MENU, TITLE, CHAPTER, JOURNAL, NAMING, SEARCH, DIALOGUE, COMPLETE, PICO8;
    companion object {
        fun parse(value: String) = entries.firstOrNull { it.name.equals(value, ignoreCase = true) } ?: FALLBACK
    }
}

enum class ControlIcon { NONE, PAUSE, PLAY, BACK, CONFIRM, UP, DOWN, LEFT, RIGHT, BOOK, EXIT, KEYBOARD, DELETE, EDIT, CLOSE, RESET }

data class ControlAction(val binding: String, val label: String, val icon: ControlIcon = ControlIcon.NONE)

data class ControlState(
    val mode: ControlMode = ControlMode.FALLBACK,
    val canTalk: Boolean = false,
    val keyboard: Boolean = false,
    val ui: String = "",
    val bindings: Map<String, List<String>> = emptyMap(),
    val touch: TouchScene? = null
)

data class ControlProfile(
    val stick: Boolean,
    val directions: Boolean,
    val menuDirections: Boolean,
    val top: ControlAction?,
    val actions: List<ControlAction>,
    val auxiliary: ControlAction? = null
) {
    companion object {
        fun forState(state: ControlState, buttons: Boolean, joystick: Boolean, direct: Boolean = false): ControlProfile {
            val enabled = buttons || joystick
            val mode = state.mode
            val playing = mode in setOf(ControlMode.GAMEPLAY, ControlMode.PICO8, ControlMode.FALLBACK)
            val navigation = mode in setOf(ControlMode.PAUSE, ControlMode.PAUSE_MENU, ControlMode.MENU, ControlMode.CHAPTER,
                ControlMode.JOURNAL, ControlMode.NAMING, ControlMode.SEARCH)
            val confirm = ControlAction("MenuConfirm", "确定", ControlIcon.CONFIRM)
            val cancel = ControlAction("MenuCancel", "返回", ControlIcon.BACK)
            val escape = ControlAction("ESC", "返回", ControlIcon.BACK)
            val actions = when (mode) {
                ControlMode.GAMEPLAY, ControlMode.FALLBACK -> if (buttons) buildList {
                    add(ControlAction("Jump", "跳")); add(ControlAction("Dash", "冲")); add(ControlAction("Grab", "抓"))
                    if (state.canTalk) add(ControlAction("Talk", "交互"))
                    if (mode == ControlMode.FALLBACK) { add(confirm); add(cancel) }
                } else emptyList()
                ControlMode.PICO8 -> if (buttons) listOf(ControlAction("Jump", "跳"), ControlAction("Dash", "冲")) else emptyList()
                ControlMode.TITLE -> listOf(confirm.copy(label = "开始"))
                ControlMode.COMPLETE, ControlMode.DIALOGUE -> listOf(confirm.copy(label = "继续"))
                ControlMode.JOURNAL -> listOf(cancel.copy(label = "关闭"))
                ControlMode.NAMING -> if (state.keyboard) listOf(
                    ControlAction("Enter", "完成", ControlIcon.CONFIRM),
                    ControlAction("Backspace", "删除", ControlIcon.DELETE)
                ) else listOf(confirm.copy(label = "输入"), cancel.copy(label = "删除", icon = ControlIcon.DELETE),
                    ControlAction("Pause", "完成", ControlIcon.CONFIRM))
                ControlMode.SEARCH -> if (state.keyboard) listOf(
                    ControlAction("Enter", "搜索", ControlIcon.CONFIRM),
                    ControlAction("Backspace", "删除", ControlIcon.DELETE)
                ) else listOf(confirm, cancel)
                ControlMode.LOADING -> emptyList()
                else -> listOf(confirm, cancel)
            }
            val top = when (mode) {
                ControlMode.LOADING -> null
                ControlMode.PAUSE -> ControlAction("ESC", "继续游戏", ControlIcon.PLAY)
                ControlMode.GAMEPLAY, ControlMode.PICO8, ControlMode.FALLBACK, ControlMode.DIALOGUE ->
                    ControlAction("ESC", "暂停", ControlIcon.PAUSE)
                ControlMode.MENU, ControlMode.CHAPTER, ControlMode.JOURNAL -> cancel
                else -> escape
            }
            val auxiliary = when {
                mode == ControlMode.CHAPTER -> ControlAction("MenuJournal", "日志", ControlIcon.BOOK)
                mode in setOf(ControlMode.NAMING, ControlMode.SEARCH) && state.keyboard -> ControlAction("Keyboard", "键盘", ControlIcon.KEYBOARD)
                else -> null
            }
            return ControlProfile(
                stick = enabled && playing && joystick,
                directions = enabled && !direct && (navigation || playing && !joystick),
                menuDirections = !playing,
                top = top.takeIf { enabled },
                actions = actions.takeIf { enabled && !direct } ?: emptyList(),
                auxiliary = auxiliary.takeIf { enabled }
            )
        }
    }
}
