package com.celemod.runtime

/** Semantic actions, kept independent of View/SDL so profiles can be regression tested. */
enum class ControlMode {
    FALLBACK, LOADING, TRANSITION, GAMEPLAY, PAUSE, PAUSE_MENU, MENU, TITLE, CHAPTER, JOURNAL, NAMING, SEARCH, DIALOGUE, COMPLETE, PICO8, CHAT, LOBBY_MAP, LOBBY_MAP_VIEW;
    companion object {
        fun parse(value: String) = entries.firstOrNull { it.name.equals(value, ignoreCase = true) } ?: FALLBACK
    }
}

enum class ControlIcon { NONE, PAUSE, PLAY, BACK, CONFIRM, UP, DOWN, LEFT, RIGHT, UP_LEFT, UP_RIGHT, DOWN_LEFT, DOWN_RIGHT, BOOK, EXIT, KEYBOARD, DELETE, EDIT, CLOSE, RESET, CHAT, BOLT, STAR }

data class ControlAction(val binding: String, val label: String, val icon: ControlIcon = ControlIcon.NONE)

data class ControlState(
    val mode: ControlMode = ControlMode.FALLBACK,
    val canTalk: Boolean = false,
    val keyboard: Boolean = false,
    val ui: String = "",
    val bindings: Map<String, List<String>> = emptyMap(),
    val touch: TouchScene? = null,
    val modEpoch: String = "",
    val modButtons: List<ModButton> = emptyList()
)

data class ControlProfile(
    val stick: Boolean,
    val directions: Boolean,
    val menuDirections: Boolean,
    val top: ControlAction?,
    val actions: List<ControlAction>,
    val auxiliary: ControlAction? = null,
    val diagonalDirections: Boolean = false
) {
    companion object {
        fun forState(state: ControlState, buttons: Boolean, joystick: Boolean, direct: Boolean = false,
                     directionMode: DirectionControlMode = DirectionControlMode.default(joystick)): ControlProfile {
            val enabled = buttons || joystick
            val mode = state.mode
            val lobbyMap = mode in setOf(ControlMode.LOBBY_MAP, ControlMode.LOBBY_MAP_VIEW)
            val playing = mode in setOf(ControlMode.GAMEPLAY, ControlMode.PICO8, ControlMode.FALLBACK)
            val navigation = mode in setOf(ControlMode.PAUSE, ControlMode.PAUSE_MENU, ControlMode.MENU, ControlMode.CHAPTER,
                ControlMode.JOURNAL, ControlMode.NAMING, ControlMode.SEARCH, ControlMode.LOBBY_MAP, ControlMode.LOBBY_MAP_VIEW)
            val confirm = ControlAction("MenuConfirm", "确定", ControlIcon.CONFIRM)
            val cancel = ControlAction("MenuCancel", "返回", ControlIcon.BACK)
            val escape = ControlAction("ESC", "返回", ControlIcon.BACK)
            val actions = when (mode) {
                ControlMode.GAMEPLAY, ControlMode.FALLBACK -> if (buttons) buildList {
                    add(ControlAction("Jump", "跳")); add(ControlAction("Dash", "冲")); add(ControlAction("Grab", "抓"))
                    if (state.canTalk) add(ControlAction("Talk", "交互"))
                    if (mode == ControlMode.GAMEPLAY) {
                        if (!state.bindings["MiaoChat"].isNullOrEmpty()) add(ControlAction("MiaoChat", "聊天", ControlIcon.CHAT))
                        if (!state.bindings["MiaoPlayers"].isNullOrEmpty()) add(ControlAction("MiaoPlayers", "玩家"))
                        if (!state.bindings["CollabMap"].isNullOrEmpty()) add(ControlAction("CollabMap", "大厅地图", ControlIcon.BOOK))
                    }
                    if (mode == ControlMode.FALLBACK) { add(confirm); add(cancel) }
                } else emptyList()
                ControlMode.PICO8 -> if (buttons) listOf(ControlAction("Jump", "跳"), ControlAction("Dash", "冲")) else emptyList()
                ControlMode.TITLE -> listOf(confirm.copy(label = "开始"))
                ControlMode.COMPLETE, ControlMode.DIALOGUE -> listOf(confirm.copy(label = "继续"))
                ControlMode.JOURNAL -> listOf(cancel.copy(label = "关闭"))
                ControlMode.CHAT -> listOf(ControlAction("Enter", "发送", ControlIcon.CONFIRM),
                    ControlAction("Backspace", "删除", ControlIcon.DELETE))
                ControlMode.LOBBY_MAP -> listOf(confirm.copy(label = "传送"), cancel.copy(label = "关闭"),
                    ControlAction("MenuJournal", "缩放", ControlIcon.BOOK))
                ControlMode.LOBBY_MAP_VIEW -> listOf(cancel.copy(label = "关闭"), ControlAction("MenuJournal", "缩放", ControlIcon.BOOK))
                ControlMode.NAMING -> if (state.keyboard) listOf(
                    ControlAction("Enter", "完成", ControlIcon.CONFIRM),
                    ControlAction("Backspace", "删除", ControlIcon.DELETE)
                ) else listOf(confirm.copy(label = "输入"), cancel.copy(label = "删除", icon = ControlIcon.DELETE),
                    ControlAction("Pause", "完成", ControlIcon.CONFIRM))
                ControlMode.SEARCH -> if (state.keyboard) listOf(
                    ControlAction("Enter", "搜索", ControlIcon.CONFIRM),
                    ControlAction("Backspace", "删除", ControlIcon.DELETE)
                ) else listOf(confirm, cancel)
                ControlMode.LOADING, ControlMode.TRANSITION -> emptyList()
                else -> listOf(confirm, cancel)
            }
            val top = when (mode) {
                ControlMode.LOADING, ControlMode.TRANSITION -> null
                ControlMode.PAUSE -> ControlAction("Pause", "继续游戏", ControlIcon.PLAY)
                ControlMode.CHAT -> ControlAction("Escape", "关闭聊天", ControlIcon.BACK)
                ControlMode.GAMEPLAY, ControlMode.DIALOGUE -> ControlAction("Pause", "暂停", ControlIcon.PAUSE)
                ControlMode.PICO8, ControlMode.FALLBACK ->
                    ControlAction("ESC", "暂停", ControlIcon.PAUSE)
                ControlMode.MENU, ControlMode.CHAPTER, ControlMode.JOURNAL, ControlMode.LOBBY_MAP, ControlMode.LOBBY_MAP_VIEW -> cancel
                else -> escape
            }
            val auxiliary = when {
                mode == ControlMode.CHAPTER -> ControlAction("MenuJournal", "日志", ControlIcon.BOOK)
                mode in setOf(ControlMode.NAMING, ControlMode.SEARCH, ControlMode.CHAT) && state.keyboard -> ControlAction("Keyboard", "键盘", ControlIcon.KEYBOARD)
                else -> null
            }
            return ControlProfile(
                stick = enabled && playing && directionMode.isStick,
                directions = enabled && (!direct || lobbyMap) && (navigation || playing && !directionMode.isStick),
                menuDirections = !playing,
                top = top.takeIf { enabled },
                actions = actions.takeIf { enabled && (!direct || mode == ControlMode.CHAT || lobbyMap) } ?: emptyList(),
                auxiliary = auxiliary.takeIf { enabled },
                diagonalDirections = enabled && !direct && playing && directionMode == DirectionControlMode.EIGHT_BUTTONS
            )
        }
    }
}
