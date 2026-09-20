package com.celemod.runtime

import android.content.Context
import android.app.AlertDialog
import android.graphics.*
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.ViewConfiguration
import android.view.WindowManager
import android.text.InputFilter
import android.text.InputType
import android.widget.EditText
import android.widget.CheckBox
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Spinner
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import org.libsdl.app.SDLActivity
import kotlin.math.*

/** Context-aware multi-touch overlay. All input ownership lives here, including Back pulses. */
class TouchControls(
    context: Context,
    private val buttons: Boolean,
    private val joystick: Boolean,
    private val onExit: () -> Unit,
    private val onKeyboard: () -> Unit,
    private val onVibration: (Int) -> Unit
) : View(context) {
    private data class Key(val id: String, val action: ControlAction, val codes: Set<Int>, val rect: RectF,
                           val direction: Boolean = false, val iconOnly: Boolean = false)
    private data class Drag(val pointer: Int, val id: String,
                            val centers: Map<String, ControlPoint>, val originals: Map<String, ControlPoint?>,
                            val startX: Float, val startY: Float, var moved: Boolean = false)
    private val keys = mutableListOf<Key>()
    private val pointers = linkedMapOf<Int, Key>()
    private val actionPointers = linkedMapOf<Int, ActionSlideGesture>()
    private val directionPointers = linkedMapOf<Int, DirectionSlideGesture>()
    private val down = mutableSetOf<Int>()
    private val pulses = mutableMapOf<Int, Any>()
    private val pressedAt = mutableMapOf<Int, Long>()
    private val handler = Handler(Looper.getMainLooper())
    private var state = ControlState()
    // Last real game-layout scene. Entering the editor pauses known gameplay, so the
    // paused state no longer reports Mod shortcuts or fallback confirm/cancel; the
    // preview keeps showing the buttons that scene exposes.
    private var gameScene: ControlState? = null
    private var profile = ControlProfile.forState(state, buttons, joystick)
    private val stickGesture = StickGesture()
    private val stickPointer get() = stickGesture.pointer
    private var sx = 0f
    private var sy = 0f
    private val stickFeedback = StickDirectionFeedback()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val density = resources.displayMetrics.density
    private val safe = Rect()
    private val preferences = context.getSharedPreferences("touch-layouts", Context.MODE_PRIVATE)
    private val contacts = ControlContacts()
    private val touchWriter = DirectTouchWriter(context.cacheDir)
    private val modWriter = ModButtonWriter(context.cacheDir)
    private var directPreferred = preferences.getBoolean("direct-touch", true)
    private val direct get() = !editing && directPreferred && (buttons || joystick) && state.touch != null
    private var directGesture: DirectGesture? = null
    private var directSequence = false
    private var directPointer = -1
    private var directStartTime = 0L
    private var textDialog: AlertDialog? = null
    private var textEpoch: String? = null
    private var hintUntil = 0L
    private var orientation = ""
    private var savedPositions: Map<String, ControlPoint> = emptyMap()
    private var savedStyles: Map<String, ControlStyle> = emptyMap()
    private var savedMergedButtons = false
    private var savedFullScreen = false
    private var draft: ControlLayoutDraft? = null
    private var editingGame = true
    private var drag: Drag? = null
    private var editorCommand: Pair<Int, String>? = null
    private var resetDialog: AlertDialog? = null
    private var styleDialog: AlertDialog? = null
    private val editing get() = draft != null
    private var stickCenter = ControlPoint(0f, 0f)
    private var layoutBounds = ControlBounds(0f, 0f, 0f, 0f)
    private var legacyBounds = layoutBounds
    private var toolbarBounds = ControlBounds(0f, 0f, 0f, 0f)
    private val radius get() = min((height - safe.top - safe.bottom) * .18f, 75 * density) * style("game/stick").scale
    private val floating get() = directionMode == DirectionControlMode.FLOATING_STICK
    private val floatingArea get() = StickInput.floatingArea(layoutBounds, toolbarBounds)
    private val visibleStickCenter get() = stickGesture.center ?: if (floating && editing)
        floatingArea.let { ControlPoint((it.left + it.right) / 2, (it.top + it.bottom) / 2) } else stickCenter
    private val cx get() = visibleStickCenter.x
    private val cy get() = visibleStickCenter.y

    private fun gameLayout(mode: ControlMode) = mode in setOf(ControlMode.GAMEPLAY, ControlMode.PICO8, ControlMode.FALLBACK)
    private val layoutGroup get() = if (if (editing) editingGame else gameLayout(state.mode)) "game" else "menu"
    private fun style(id: String) = if (editing) draft!!.style(id) else savedStyles[id] ?: ControlStyle()
    private val directionMode get() = style("game/stick").directionMode ?: DirectionControlMode.default(joystick)
    private fun slideAction(key: Key) = key.id.startsWith("game/action/") || key.id.contains("/custom/")
    private fun heldActionKeys(): List<Key> {
        val ids = actionPointers.values.flatMap { it.active() }.toSet()
        return keys.filter { it.id in ids }
    }

    fun setState(next: ControlState) {
        if (state == next) return
        if (next.touch?.epoch != state.touch?.epoch) {
            if (textEpoch != null && textEpoch != next.touch?.epoch) { textDialog?.dismiss(); textDialog = null; textEpoch = null }
            hintUntil = SystemClock.uptimeMillis() + 2500
        }
        if (editing) {
            // A load may finish, or a controller may resume the level while the
            // editor is open. Keep the preview stable and request pause again.
            val enteredGameplay = next.mode == ControlMode.GAMEPLAY && state.mode != ControlMode.GAMEPLAY
            state = next
            if (enteredGameplay) requestPause()
            return
        }
        // Merely walking into/out of Talk range must NOT drop a held climb/jump.
        // Changing scenes, input mode or bindings must not carry a hold into a menu.
        if (state.mode != next.mode || state.ui != next.ui || state.bindings != next.bindings || state.keyboard != next.keyboard ||
            state.touch?.epoch != next.touch?.epoch || state.modEpoch != next.modEpoch || state.modButtons != next.modButtons)
            releaseAll()
        state = next
        if (gameLayout(next.mode)) gameScene = next
        profile = ControlProfile.forState(state, buttons, joystick, direct, directionMode)
        rebuild()
    }

    override fun onApplyWindowInsets(insets: WindowInsets): WindowInsets {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            val edge = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            safe.set(edge.left, edge.top, edge.right, edge.bottom)
        } else {
            @Suppress("DEPRECATION")
            safe.set(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            insets.displayCutout?.let {
                safe.left = max(safe.left, it.safeInsetLeft); safe.right = max(safe.right, it.safeInsetRight)
                safe.top = max(safe.top, it.safeInsetTop); safe.bottom = max(safe.bottom, it.safeInsetBottom)
            }
        }
        releaseAll(); rebuild()
        return insets
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        releaseAll()
        val next = if (w >= h) "landscape" else "portrait"
        if (orientation != next) {
            if (editing) {
                draft = null
                styleDialog?.dismiss(); styleDialog = null
                resetDialog?.dismiss(); resetDialog = null
                Toast.makeText(context, "屏幕方向已改变，未保存的布局编辑已取消", Toast.LENGTH_SHORT).show()
            }
            orientation = next
            savedPositions = ControlLayout.decode(preferences.getString(orientation, null))
            savedStyles = ControlStyle.decode(preferences.getString("$orientation/styles", null))
            savedMergedButtons = savedStyles["game/stick"]?.directionLayout == DirectionLayoutMode.MERGED
            savedFullScreen = preferences.getBoolean("$orientation/full-screen-centers", false)
        }
        rebuild()
    }

    private fun rebuild() {
        keys.clear()
        if (width == 0 || height == 0) return
        val w = width - safe.right.toFloat()
        val h = height - safe.bottom.toFloat()
        val size = min((h - safe.top) * .16f, 65 * density)
        val margin = min(18 * density, size * .28f)
        val topSize = size * .78f
        layoutBounds = ControlBounds(0f, 0f, width.toFloat(), height.toFloat())
        legacyBounds = ControlBounds(safe.left + margin, safe.top + margin, w - margin, h - margin)
        val toolbarCount = if (editing) 4 else if (buttons || joystick) 3 else 2
        toolbarBounds = ControlBounds(safe.left.toFloat(), safe.top.toFloat(),
            safe.left + margin + toolbarCount * (topSize + margin), safe.top + topSize + 2 * margin)
        profile = if (!editing) ControlProfile.forState(state, buttons, joystick, direct, directionMode)
            // The preview follows the scene: conditional buttons stay editable exactly while
            // that scene shows them, instead of being listed for every user.
            else ControlProfile.forEditor(editingGame, joystick, directionMode, gameScene)
        fun key(id: String, action: ControlAction, x: Float, y: Float, side: Float = size,
                direction: Boolean = false, iconOnly: Boolean = false, codes: Set<Int>? = null) {
            val actualSide = if (id.startsWith("fixed/")) side else side * style(id).scale
            val center = if (id.startsWith("fixed/")) ControlPoint(x + side / 2, y + side / 2)
                else place(id, ControlPoint(x + side / 2, y + side / 2))
            keys += Key(id, action, codes ?: ControlKeys.resolveAll(state, action.binding),
                RectF(center.x - actualSide / 2, center.y - actualSide / 2,
                    center.x + actualSide / 2, center.y + actualSide / 2), direction, iconOnly)
        }
        // Fixed controls stay in the safe area and render above overlapping custom controls.
        val toolbar = if (editing) listOf(
            ControlAction("SaveLayout", "保存", ControlIcon.CONFIRM),
            ControlAction("CancelLayout", "取消", ControlIcon.CLOSE),
            ControlAction("ResetLayout", "重置", ControlIcon.RESET),
            ControlAction("SwitchLayout", if (editingGame) "到菜单" else "到游戏"),
        ) else buildList {
            add(ControlAction("Edit", "编辑", ControlIcon.EDIT))
            add(ControlAction("Exit", "返回管理器", ControlIcon.EXIT))
            if (buttons || joystick) add(ControlAction("ToggleTouch", if (directPreferred) "按键" else "触屏"))
        }
        toolbar.forEachIndexed { i, action ->
            key("fixed/${action.binding}", action, safe.left + margin + i * (topSize + margin), safe.top + margin,
                topSize, iconOnly = action.binding == "Exit")
        }
        profile.top?.let { key("shared/top", it, w - topSize - margin, safe.top + margin, topSize, iconOnly = true) }
        profile.auxiliary?.let { key("shared/aux", it, w - 2 * topSize - 2 * margin, safe.top + margin, topSize, iconOnly = true) }
        profile.actions.forEachIndexed { i, action ->
            val column = if (i % 2 == 0) 0 else 1
            val row = i / 2
            val id = if (layoutGroup == "game") action.binding else i.toString()
            key("$layoutGroup/action/$id", action, w - (column + 1) * (size + margin), h - (row + 1) * (size + margin))
        }
        if (editing || ModButtons.visible(state.mode)) {
            state.modButtons.filter { editing || it.available }.forEachIndexed { i, button ->
                val columns = max(1, (layoutBounds.width * .5f / (size + margin)).toInt())
                val x = layoutBounds.left + layoutBounds.width * .3f + (i % columns) * (size + margin)
                val y = toolbarBounds.bottom + margin + (i / columns) * (size + margin)
                key("$layoutGroup/custom/${button.id}", ControlAction("Custom/${button.id}", button.label, button.icon),
                    x, y, iconOnly = button.icon != ControlIcon.NONE, codes = if (button.available) setOf(button.code) else emptySet())
            }
        }
        if (profile.directions) {
            val step = size + margin * .25f
            val left = safe.left + margin
            val bottom = h - size - margin
            val prefix = if (profile.menuDirections) "Menu" else ""
            key("$layoutGroup/dpad/Left", ControlAction(prefix + "Left", "左", ControlIcon.LEFT), left, bottom - step, direction = true, iconOnly = true)
            key("$layoutGroup/dpad/Down", ControlAction(prefix + "Down", "下", ControlIcon.DOWN), left + step, bottom, direction = true, iconOnly = true)
            key("$layoutGroup/dpad/Right", ControlAction(prefix + "Right", "右", ControlIcon.RIGHT), left + 2 * step, bottom - step, direction = true, iconOnly = true)
            key("$layoutGroup/dpad/Up", ControlAction(prefix + "Up", "上", ControlIcon.UP), left + step, bottom - 2 * step, direction = true, iconOnly = true)
            if (profile.diagonalDirections) {
                key("game/dpad/UpLeft", ControlAction("UpLeft", "左上", ControlIcon.UP_LEFT), left, bottom - 2 * step, direction = true, iconOnly = true)
                key("game/dpad/UpRight", ControlAction("UpRight", "右上", ControlIcon.UP_RIGHT), left + 2 * step, bottom - 2 * step, direction = true, iconOnly = true)
                key("game/dpad/DownLeft", ControlAction("DownLeft", "左下", ControlIcon.DOWN_LEFT), left, bottom, direction = true, iconOnly = true)
                key("game/dpad/DownRight", ControlAction("DownRight", "右下", ControlIcon.DOWN_RIGHT), left + 2 * step, bottom, direction = true, iconOnly = true)
            }
        }
        // Scaling an untouched stick must not move its anchor.
        val baseRadius = min((height - safe.top - safe.bottom) * .18f, 75 * density)
        stickCenter = place("game/stick", ControlPoint(safe.left + baseRadius + 26 * density,
            height - safe.bottom - baseRadius - 25 * density))
        contentDescription = if (editing) "布局编辑：拖动调整位置，轻点设置方向模式、大小、滑出行为、震动和不透明度；左上角保存、取消、重置、切换布局"
            else "游戏触控：${state.mode.name}；左上角编辑布局、返回管理器"
        invalidate()
    }

    private fun place(id: String, default: ControlPoint): ControlPoint {
        val position = if (editing) draft?.get(id) else savedPositions[id]
        // Leave untouched default positions alone outside the editor.
        if (position == null && !editing && style(id).scale == 1f && !id.contains("/custom/")) return default
        val center = position?.let { ControlLayout.project(it, if (editing || savedFullScreen) layoutBounds else legacyBounds) } ?: default
        return ControlLayout.constrain(center, layoutBounds)
    }

    private fun editableCenters(): Map<String, ControlPoint> = buildMap {
        for (key in this@TouchControls.keys) if (key.id.startsWith("$layoutGroup/dpad/"))
            put(key.id, ControlPoint(key.rect.centerX(), key.rect.centerY()))
        // A floating stick has no movable layout anchor, but still shares style edits.
    }

    private fun editableIds() = editableCenters().keys

    private fun keyAt(x: Float, y: Float): Key? =
        keys.firstOrNull { it.id.startsWith("fixed/") && it.rect.contains(x, y) }
            ?: keys.lastOrNull { it.rect.contains(x, y) }

    override fun onDraw(canvas: Canvas) {
        if (direct) {
            val now = SystemClock.uptimeMillis()
            if (now < hintUntil) {
                paint.style = Paint.Style.FILL; paint.color = 0xCCFFFFFF.toInt()
                paint.textSize = 12 * density; paint.textAlign = Paint.Align.CENTER
                val hint = when (state.touch!!.kind) {
                    "journal" -> "左右滑动翻页"
                    "chapters" -> "点选章节 · 左右切换章节 · 上下切换地图集"
                    "continue" -> "轻点继续"
                    "text" -> "轻点文本使用手机键盘，也可点选字符"
                    "chat" -> "轻点输入框填入文字 · 点发送发送 · 左右滑动频道栏"
                    "lobby_map" -> "拖动平移 · 方向键切换大厅/目的地 · 缩放 · 确认传送"
                    else -> "直接点选 · 滑动列表 · 左上角可切回按键"
                }
                canvas.drawText(hint, width / 2f, height - safe.bottom - 8 * density, paint)
                postInvalidateDelayed(2500)
            }
        }
        if (editing) canvas.drawColor(0x66000000)
        if (editing && profile.stick && floating) {
            val area = floatingArea
            paint.style = Paint.Style.FILL; paint.color = 0x2282B8FF
            canvas.drawRect(area.left, area.top, area.right, area.bottom, paint)
            paint.style = Paint.Style.STROKE; paint.strokeWidth = density; paint.color = 0xAA82B8FF.toInt()
            canvas.drawRect(area.left, area.top, area.right, area.bottom, paint)
            paint.style = Paint.Style.FILL; paint.textAlign = Paint.Align.CENTER; paint.textSize = 12 * density
            canvas.drawText("浮动摇杆触发区域 · 按钮优先", (area.left + area.right) / 2, area.bottom - 12 * density, paint)
        }
        if (profile.stick && (!floating || editing || stickPointer != -1)) {
            val layer = saveControlLayer(canvas, "game/stick", RectF(cx - radius, cy - radius, cx + radius, cy + radius))
            if (style("game/stick").stickDisplay == StickDisplayMode.RING) drawStickRing(canvas)
            else {
                paint.style = Paint.Style.FILL
                paint.color = if (drag?.id == "game/stick") 0x9982B8FF.toInt() else 0x66313E51
                canvas.drawCircle(cx, cy, radius, paint)
                paint.style = Paint.Style.STROKE; paint.strokeWidth = density; paint.color = 0x6682B8FF
                canvas.drawCircle(cx, cy, radius * style("game/stick").stickDeadZone, paint)
                paint.style = Paint.Style.FILL
                paint.color = 0xAA82B8FF.toInt()
                canvas.drawCircle(cx + sx * radius * .65f, cy + sy * radius * .65f, radius * .35f, paint)
            }
            if (editing) {
                paint.style = Paint.Style.STROKE; paint.strokeWidth = 2 * density; paint.color = Color.WHITE
                canvas.drawCircle(cx, cy, radius, paint)
            }
            canvas.restoreToCount(layer)
        }
        val heldActions = heldActionKeys().map { it.id }.toSet()
        for (key in keys.sortedBy { it.id.startsWith("fixed/") }) {
            val layer = saveControlLayer(canvas, key.id, key.rect)
            paint.style = Paint.Style.FILL
            paint.color = if ((key.codes.isNotEmpty() && key.codes.all { it in down }) || key in pointers.values || key.id in heldActions || drag?.id == key.id || drag?.centers?.containsKey(key.id) == true ||
            drag?.centers?.containsKey(key.id) == true)
                0xBB82B8FF.toInt() else 0x88313E51.toInt()
            canvas.drawRoundRect(key.rect, 12 * density, 12 * density, paint)
            if (editing && !key.id.startsWith("fixed/")) {
                paint.style = Paint.Style.STROKE; paint.strokeWidth = density; paint.color = 0xCCFFFFFF.toInt()
                canvas.drawRoundRect(key.rect, 12 * density, 12 * density, paint)
                paint.style = Paint.Style.FILL
            }
            paint.color = Color.WHITE
            if (key.action.icon != ControlIcon.NONE) {
                val iconSize = key.rect.width() * if (key.iconOnly) .47f else .36f
                drawIcon(canvas, key.action.icon, key.rect.centerX(),
                    key.rect.centerY() - if (key.iconOnly) 0f else key.rect.height() * .13f, iconSize)
            }
            if (!key.iconOnly) {
                paint.style = Paint.Style.FILL
                paint.textAlign = Paint.Align.CENTER
                paint.textSize = min(15 * density, key.rect.height() * .28f)
                if (key.id.contains("/custom/")) {
                    val measured = paint.measureText(key.action.label)
                    if (measured > key.rect.width() * .9f) paint.textSize *= key.rect.width() * .9f / measured
                }
                val y = if (key.action.icon == ControlIcon.NONE) key.rect.centerY() else key.rect.top + key.rect.height() * .76f
                canvas.drawText(key.action.label, key.rect.centerX(), y - (paint.ascent() + paint.descent()) / 2, paint)
            }
            canvas.restoreToCount(layer)
        }
        if (editing) {
            paint.style = Paint.Style.FILL
            paint.color = Color.WHITE; paint.textAlign = Paint.Align.CENTER; paint.textSize = 13 * density
            val hint = "${if (editingGame) "游戏" else "菜单"}布局 · ${if (draft?.mergedButtons == true) "方向合并编辑" else "独立方向编辑"} · 拖动移位 · 轻点设置 · 保存后生效"
            canvas.drawText(hint, width / 2f, toolbarBounds.bottom + 20 * density, paint)
        }
    }

    /** Annular sectors leave the dead zone unpainted, including during highlighting. */
    private fun drawStickRing(canvas: Canvas) {
        val outer = RectF(cx - radius, cy - radius, cx + radius, cy + radius)
        val innerRadius = radius * style("game/stick").stickDeadZone
        val inner = RectF(cx - innerRadius, cy - innerRadius, cx + innerRadius, cy + innerRadius)
        val active = StickDirection.fromVector(sx, sy)
        for (direction in StickDirection.entries) {
            val start = direction.ordinal * 45f - 22.5f
            val sector = Path().apply {
                arcTo(outer, start, 45f, true)
                if (innerRadius > 0f) arcTo(inner, start + 45f, -45f, false) else lineTo(cx, cy)
                close()
            }
            paint.style = Paint.Style.FILL
            paint.color = if (direction == active) 0xDD82B8FF.toInt() else 0x88313E51.toInt()
            canvas.drawPath(sector, paint)
            // Clip strokes to the sector so no border leaks into the transparent hole.
            val clip = canvas.save()
            canvas.clipPath(sector)
            paint.style = Paint.Style.STROKE; paint.strokeWidth = density; paint.color = 0xAA82B8FF.toInt()
            canvas.drawPath(sector, paint)
            canvas.restoreToCount(clip)
        }
        paint.style = Paint.Style.FILL
    }

    private fun controlAlpha(id: String): Int {
        if (id.startsWith("fixed/")) return 255
        // Fully transparent controls must remain discoverable in the editor.
        return (style(id).opacity.coerceAtLeast(if (editing) .25f else 0f) * 255).roundToInt()
    }

    private fun saveControlLayer(canvas: Canvas, id: String, bounds: RectF): Int {
        val alpha = controlAlpha(id)
        if (alpha == 255) return canvas.save()
        // Composite the background, label and icon together without allocating a
        // screen-sized offscreen buffer for every button on every game frame.
        val padded = RectF(bounds).apply { inset(-2 * density, -2 * density) }
        return canvas.saveLayerAlpha(padded, alpha)
    }

    /** Vector icons instead of font glyphs/emoji (consistent across Android fonts). */
    private fun drawIcon(canvas: Canvas, icon: ControlIcon, x: Float, y: Float, size: Float) {
        canvas.save(); canvas.translate(x, y); canvas.scale(size / 24, size / 24)
        paint.style = Paint.Style.STROKE; paint.strokeWidth = 2.5f; paint.strokeCap = Paint.Cap.ROUND; paint.strokeJoin = Paint.Join.ROUND
        fun path(vararg points: Float) {
            val p = Path(); p.moveTo(points[0], points[1])
            for (i in 2 until points.size step 2) p.lineTo(points[i], points[i + 1])
            canvas.drawPath(p, paint)
        }
        when (icon) {
            ControlIcon.PAUSE -> { canvas.drawLine(-5f, -9f, -5f, 9f, paint); canvas.drawLine(5f, -9f, 5f, 9f, paint) }
            ControlIcon.PLAY -> { val p = Path(); p.moveTo(-6f, -10f); p.lineTo(10f, 0f); p.lineTo(-6f, 10f); p.close(); paint.style = Paint.Style.FILL; canvas.drawPath(p, paint) }
            ControlIcon.CONFIRM -> path(-9f, 0f, -3f, 6f, 10f, -7f)
            ControlIcon.BACK -> { path(-2f, -8f, -10f, 0f, -2f, 8f); canvas.drawLine(-10f, 0f, 10f, 0f, paint) }
            ControlIcon.UP -> path(-8f, 4f, 0f, -5f, 8f, 4f)
            ControlIcon.DOWN -> path(-8f, -4f, 0f, 5f, 8f, -4f)
            ControlIcon.LEFT -> path(4f, -8f, -5f, 0f, 4f, 8f)
            ControlIcon.RIGHT -> path(-4f, -8f, 5f, 0f, -4f, 8f)
            ControlIcon.UP_LEFT, ControlIcon.UP_RIGHT, ControlIcon.DOWN_LEFT, ControlIcon.DOWN_RIGHT -> {
                val dx = if (icon == ControlIcon.UP_LEFT || icon == ControlIcon.DOWN_LEFT) -1f else 1f
                val dy = if (icon == ControlIcon.UP_LEFT || icon == ControlIcon.UP_RIGHT) -1f else 1f
                path(-6f * dx, -6f * dy, 7f * dx, 7f * dy)
                path(-3f * dx, 7f * dy, 7f * dx, 7f * dy, 7f * dx, -3f * dy)
            }
            ControlIcon.BOOK -> { canvas.drawRoundRect(-9f, -10f, 9f, 10f, 2f, 2f, paint); canvas.drawLine(-3f, -10f, -3f, 10f, paint); canvas.drawLine(1f, -4f, 5f, -4f, paint) }
            ControlIcon.EXIT -> { path(-2f, -10f, -10f, -10f, -10f, 10f, -2f, 10f); path(4f, -6f, 10f, 0f, 4f, 6f); canvas.drawLine(-4f, 0f, 10f, 0f, paint) }
            ControlIcon.DELETE -> { path(-4f, -8f, 10f, -8f, 10f, 8f, -4f, 8f, -11f, 0f, -4f, -8f); path(0f, -3f, 6f, 3f); path(0f, 3f, 6f, -3f) }
            ControlIcon.KEYBOARD -> {
                canvas.drawRoundRect(-11f, -8f, 11f, 8f, 2f, 2f, paint)
                for (dx in -6..6 step 6) canvas.drawPoint(dx.toFloat(), -3f, paint)
                canvas.drawLine(-5f, 3f, 5f, 3f, paint)
            }
            ControlIcon.EDIT -> { path(-9f, 9f, -7f, 2f, 5f, -10f, 10f, -5f, -2f, 7f, -9f, 9f); path(2f, -7f, 7f, -2f) }
            ControlIcon.CLOSE -> { path(-8f, -8f, 8f, 8f); path(-8f, 8f, 8f, -8f) }
            ControlIcon.RESET -> { canvas.drawArc(-9f, -9f, 9f, 9f, -160f, 290f, false, paint); path(-10f, -10f, -10f, -2f, -2f, -2f) }
            ControlIcon.CHAT -> path(-10f, -8f, 10f, -8f, 10f, 5f, 0f, 5f, -6f, 10f, -6f, 5f, -10f, 5f, -10f, -8f)
            ControlIcon.BOLT -> path(2f, -11f, -8f, 2f, -1f, 2f, -3f, 11f, 9f, -3f, 2f, -3f, 2f, -11f)
            ControlIcon.STAR -> path(0f, -11f, 3f, -4f, 11f, -3f, 5f, 2f, 7f, 10f, 0f, 6f, -7f, 10f, -5f, 2f, -11f, -3f, -3f, -4f, 0f, -11f)
            ControlIcon.NONE -> Unit
        }
        canvas.restore(); paint.style = Paint.Style.FILL
    }

    private fun syncKeys() {
        val next = pulses.keys.toMutableSet()
        // Menu navigation is deliberately cardinal, even with two fingers down.
        val direction = if (profile.menuDirections) pointers.values.lastOrNull { it.direction } else null
        for (key in pointers.values) {
            if (!key.direction || !profile.menuDirections || key === direction) next += key.codes
        }
        for (key in heldActionKeys()) next += key.codes
        StickDirection.fromVector(sx, sy)?.bindings?.forEach { next += ControlKeys.resolveAll(state, it) }
        for (code in down - next) { if (code >= 0) SDLActivity.onNativeKeyUp(code); pressedAt.remove(code) }
        for (code in next - down) { if (code >= 0) SDLActivity.onNativeKeyDown(code); pressedAt[code] = SystemClock.uptimeMillis() }
        down.clear(); down.addAll(next)
        modWriter.set(state.modEpoch, ModButtons.held(state.modButtons, down))
    }
    private fun updateStick(x: Float, y: Float): Int {
        val settings = style("game/stick")
        val vector = stickGesture.vector(ControlPoint(x, y), radius, settings.stickDeadZone)
        sx = vector.x; sy = vector.y
        val entered = stickFeedback.update(StickDirection.fromVector(sx, sy))
        return if (stickFeedback.enteredDeadZone) settings.deadZoneVibrationStrength()
            else entered?.let { settings.stickVibrationStrength(it) } ?: 0
    }

    /** Keydown/up in the same UI tick can be lost before FNA's next input poll. */
    fun escape() {
        if (editing) { finishEditing(save = false); return }
        val code = KeyEvent.KEYCODE_ESCAPE
        if (code in down) return
        pulse(code, 100); syncKeys(); invalidate()
    }

    private fun pulse(code: Int, duration: Long) {
        val token = Any()
        pulses[code] = token
        handler.postDelayed({
            // An older tap must not release a newer pulse for the same key.
            if (pulses[code] === token) { pulses.remove(code); syncKeys(); invalidate() }
        }, duration)
    }

    private fun finishPress(key: Key?) {
        if (key == null) return
        // A very fast tap otherwise produces SDL down+up between FNA frames and
        // disappears entirely. Preserve a short pulse, not a menu auto-repeat.
        val minimum = if (profile.menuDirections || key.iconOnly) 80L else 32L
        for (code in key.codes) {
            val started = pressedAt[code] ?: continue
            val remaining = minimum - (SystemClock.uptimeMillis() - started)
            if (remaining > 0 && code !in pulses) pulse(code, remaining)
        }
    }

    private fun requestPause() {
        val action = if (state.mode == ControlMode.PICO8) "ESC" else "Pause"
        ControlKeys.resolveAll(state, action).forEach { pulse(it, 100) }
        syncKeys()
    }

    private fun startEditing() {
        releaseAll()
        textDialog?.dismiss(); textDialog = null; textEpoch = null
        editingGame = gameLayout(state.mode)
        val positions = if (savedFullScreen) savedPositions else savedPositions.mapValues { (_, point) ->
            ControlLayout.normalize(ControlLayout.project(point, legacyBounds), layoutBounds)
        }
        draft = ControlLayoutDraft(positions, savedStyles, savedMergedButtons)
        // Pause known gameplay using its binding. Never send Escape in an unknown
        // mod scene (it might mean exit), and never auto-resume after editing.
        if (state.mode == ControlMode.GAMEPLAY || state.mode == ControlMode.PICO8) {
            requestPause()
        }
        rebuild()
    }

    private fun finishEditing(save: Boolean) {
        releaseAll()
        if (save) {
            savedPositions = draft?.snapshot() ?: savedPositions
            savedStyles = draft?.styleSnapshot() ?: savedStyles
            savedMergedButtons = draft?.mergedButtons ?: savedMergedButtons
            savedFullScreen = true
            preferences.edit().putString(orientation, ControlLayout.encode(savedPositions))
                .putString("$orientation/styles", ControlStyle.encode(savedStyles))
                .putBoolean("$orientation/full-screen-centers", true).apply()
        }
        draft = null
        resetDialog?.dismiss(); resetDialog = null
        styleDialog?.dismiss(); styleDialog = null
        rebuild()
        Toast.makeText(context, if (save) "按键布局已保存" else "已取消，保留原布局", Toast.LENGTH_SHORT).show()
    }

    private fun cancelDrag() {
        drag?.originals?.forEach { (id, point) -> draft?.restore(id, point) }
        drag = null; editorCommand = null
    }

    private fun moveDrag(x: Float, y: Float) {
        val target = drag ?: return
        if (!target.moved && hypot(x - target.startX, y - target.startY) <= ViewConfiguration.get(context).scaledTouchSlop) return
        target.moved = true
        // Floating centers belong only to gestures; editing the preview must not
        // overwrite the stored fixed-stick anchor or imply the activation area moved.
        val centers = target.centers
        ControlLayout.translate(centers, ControlPoint(x - target.startX, y - target.startY), layoutBounds)
            .forEach { (id, point) -> draft?.move(id, ControlLayout.normalize(point, layoutBounds)) }
        rebuild()
    }

    private fun editStyle(id: String) {
        val editingDraft = draft ?: return
        if (styleDialog?.isShowing == true) return
        val key = keys.firstOrNull { it.id == id }
        val label = key?.action?.label ?: "摇杆"
        val original = editingDraft.style(id)
        var scale = original.scale
        var behavior = original.slide
        var directionBehavior = original.directionSlide
        var opacity = original.opacity
        var enterVibration = original.enterVibration
        var leaveVibration = original.leaveVibration
        var enterStrength = original.enterStrength
        var leaveStrength = original.leaveStrength
        var stickDiagonalVibration = original.stickDiagonalVibration
        var stickCardinalVibration = original.stickCardinalVibration
        var stickDiagonalStrength = original.stickDiagonalStrength
        var stickCardinalStrength = original.stickCardinalStrength
        var stickDeadZone = original.stickDeadZone
        var stickDeadZoneVibration = original.stickDeadZoneVibration
        var stickDeadZoneStrength = original.stickDeadZoneStrength
        var stickDisplay = style("game/stick").stickDisplay
        var selectedMode = directionMode
        val canChangeMode = id == "game/stick" || id.startsWith("game/dpad/")
        // Batch scope follows the selected gameplay mode; menu batches stay cardinal.
        var batchToggle: CheckBox? = null
        fun batchMode() = if (id.startsWith("game/") && selectedMode == DirectionControlMode.EIGHT_BUTTONS)
            DirectionControlMode.EIGHT_BUTTONS else DirectionControlMode.FOUR_BUTTONS
        fun updateBatchLabel() {
            batchToggle?.text = if (batchMode() == DirectionControlMode.EIGHT_BUTTONS) "应用到八键" else "应用到四键"
            batchToggle?.isEnabled = !canChangeMode || !selectedMode.isStick
        }
        val padding = (20 * density).toInt()
        val content = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding / 2, padding, padding / 2)
        }
        var mergedButtons = editingDraft.mergedButtons
        if (canChangeMode) {
            content.addView(CheckBox(context).apply {
                text = "合并方向按钮（四键 / 八键）"; isChecked = mergedButtons
                setOnCheckedChangeListener { _, checked -> mergedButtons = checked }
            })
            content.addView(TextView(context).apply {
                text = "开启后只接管当前四键 / 八键方向盘：方向按钮作为整体移动、统一大小和属性。动作按钮、摇杆、工具栏仍独立调整。"; textSize = 13f
            })
        }
        if (canChangeMode) {
            content.addView(TextView(context).apply { text = "游戏方向控制（菜单仍为四键）"; textSize = 16f })
            content.addView(RadioGroup(context).apply {
                DirectionControlMode.entries.forEach { option ->
                    addView(RadioButton(context).apply {
                        this.id = View.generateViewId(); text = option.label; textSize = 14f
                        isChecked = option == selectedMode
                        setOnCheckedChangeListener { _, checked -> if (checked) { selectedMode = option; updateBatchLabel() } }
                    })
                }
            })
            content.addView(TextView(context).apply { text = "摇杆显示模式（固定 / 浮动通用）"; textSize = 16f })
            content.addView(RadioGroup(context).apply {
                StickDisplayMode.entries.forEach { option ->
                    addView(RadioButton(context).apply {
                        this.id = View.generateViewId(); text = option.label; isChecked = option == stickDisplay
                        setOnCheckedChangeListener { _, checked -> if (checked) stickDisplay = option }
                    })
                }
            })
        }
        val sizeLabel = TextView(context).apply { text = "大小：${(scale * 100).roundToInt()}%"; textSize = 16f }
        content.addView(sizeLabel)
        content.addView(SeekBar(context).apply {
            max = 50; progress = ((scale * 100 - 50) / 5).roundToInt()
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(bar: SeekBar?, value: Int, fromUser: Boolean) {
                    scale = (50 + value * 5) / 100f
                    sizeLabel.text = "大小：${50 + value * 5}%"
                }
                override fun onStartTrackingTouch(bar: SeekBar?) = Unit
                override fun onStopTrackingTouch(bar: SeekBar?) = Unit
            })
        }, LinearLayout.LayoutParams(-1, -2))
        // The editor dialog owns focus, so game feedback correctly stays disabled.
        // Explicit previews have their own short-lived source and never save settings.
        val vibrationPreview = GameVibration(context, false)
        fun percentSlider(title: String, initial: Int, presets: Boolean = false, maximum: Int = 100, changed: (Int) -> Unit): SeekBar {
            val valueLabel = TextView(context).apply { text = "$title：$initial%"; textSize = 16f }
            content.addView(valueLabel)
            val selector = if (presets) Spinner(context).apply {
                adapter = ArrayAdapter(context, android.R.layout.simple_spinner_item,
                    listOf("自定义（每 1% 微调）") + ControlStyle.strengthPresets.map {
                        when (it) { 0 -> "0% · 无震动"; 100 -> "100% · 最强"; else -> "$it%" }
                    }).apply { setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
                setSelection(ControlStyle.strengthPresets.indexOf(initial) + 1)
                content.addView(this, LinearLayout.LayoutParams(-1, -2))
            } else null
            return SeekBar(context).apply {
                max = maximum; progress = initial
                val slider = this
                selector?.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                    override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, itemId: Long) {
                        if (position > 0) slider.progress = ControlStyle.strengthPresets[position - 1]
                    }
                    override fun onNothingSelected(parent: AdapterView<*>?) = Unit
                }
                setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                    override fun onProgressChanged(bar: SeekBar?, value: Int, fromUser: Boolean) {
                        valueLabel.text = "$title：$value%"; changed(value)
                        selector?.setSelection(ControlStyle.strengthPresets.indexOf(value) + 1)
                    }
                    override fun onStartTrackingTouch(bar: SeekBar?) = Unit
                    override fun onStopTrackingTouch(bar: SeekBar?) = Unit
                })
                content.addView(this, LinearLayout.LayoutParams(-1, -2))
                if (presets) content.addView(android.widget.Button(context).apply {
                    text = "试震：当前强度（固定 20 毫秒）"
                    setOnClickListener {
                        vibrationPreview.setActive(styleDialog?.window?.decorView?.hasWindowFocus() == true)
                        vibrationPreview.touch(slider.progress)
                    }
                }, LinearLayout.LayoutParams(-1, -2))
            }
        }
        percentSlider("不透明度（Opacity）", (opacity * 100).roundToInt()) { opacity = it / 100f }
        content.addView(TextView(context).apply {
            text = "0% 完全透明，100% 保持原始外观；编辑时至少显示 25%，透明不影响触控。"; textSize = 13f
        })
        val enterToggle = CheckBox(context).apply {
            text = "进入时震动"; isChecked = enterVibration
        }
        content.addView(enterToggle)
        percentSlider("进入震动强度", enterStrength, presets = true) { enterStrength = it }
        enterToggle.setOnCheckedChangeListener { _, checked -> enterVibration = checked }
        val leaveToggle = CheckBox(context).apply {
            text = "离开时震动"; isChecked = leaveVibration
        }
        content.addView(leaveToggle)
        percentSlider("离开震动强度", leaveStrength, presets = true) { leaveStrength = it }
        leaveToggle.setOnCheckedChangeListener { _, checked -> leaveVibration = checked }
        if (id == "game/stick") {
            percentSlider("死区比例（相对摇杆半径）", (stickDeadZone * 100).roundToInt(), maximum = 90) { stickDeadZone = it / 100f }
            content.addView(TextView(context).apply {
                text = "0–90%，默认 18%；中心死区内不输入方向。浮动摇杆在屏幕左半侧、工具栏下方的空白区域按下出现，以落点为中心拖动；抬手隐藏，按钮优先。编辑时可查看触发区域，固定位置不会被覆盖。"; textSize = 13f
            })
            content.addView(TextView(context).apply { text = "摇杆方向变化震动"; textSize = 16f })
            content.addView(CheckBox(context).apply {
                text = "切换到斜向时震动（45° / 135° / 225° / 315°）"
                isChecked = stickDiagonalVibration
                setOnCheckedChangeListener { _, checked -> stickDiagonalVibration = checked }
            })
            percentSlider("斜向震动强度", stickDiagonalStrength, presets = true) { stickDiagonalStrength = it }
            content.addView(CheckBox(context).apply {
                text = "切换到正向时震动（0° / 90° / 180° / 270°）"
                isChecked = stickCardinalVibration
                setOnCheckedChangeListener { _, checked -> stickCardinalVibration = checked }
            })
            percentSlider("正向震动强度", stickCardinalStrength, presets = true) { stickCardinalStrength = it }
            content.addView(CheckBox(context).apply {
                text = "进入死区时震动"
                isChecked = stickDeadZoneVibration
                setOnCheckedChangeListener { _, checked -> stickDeadZoneVibration = checked }
            })
            percentSlider("进入死区震动强度", stickDeadZoneStrength, presets = true) { stickDeadZoneStrength = it }
            content.addView(TextView(context).apply {
                text = "按实际八向输入的方向区间触发，不必精确停在角度上。同方向或停留死区不重复；从有效方向回到死区仅触发一次死区震动。初次按在中心、抬手或取消不触发死区震动。与进入 / 离开震动独立。"; textSize = 13f
            })
        }
        content.addView(TextView(context).apply {
            text = "进入含按下 / 滑入，离开含滑出 / 抬手；仅响应触控区域变化，不改变锁定 / 叠加行为。强度调节振幅，不改变 20 毫秒时长；可用试震对比 20% / 50% / 100%，不必先开启或保存。0% 不震动；不支持振幅控制的设备只能使用系统默认强度，无法实现真实强弱。"; textSize = 13f
        })
        if (key != null && slideAction(key)) {
            content.addView(TextView(context).apply { text = "手指从这个按键滑出时"; textSize = 16f })
            content.addView(RadioGroup(context).apply {
                ControlSlideBehavior.entries.forEach { option ->
                    addView(RadioButton(context).apply {
                        this.id = View.generateViewId(); text = option.label; textSize = 14f
                        isChecked = option == behavior
                        setOnCheckedChangeListener { _, checked -> if (checked) behavior = option }
                    })
                }
            })
        } else if (key?.direction == true) {
            content.addView(TextView(context).apply { text = "移出按钮区域但手指仍按住时"; textSize = 16f })
            content.addView(RadioGroup(context).apply {
                DirectionSlideBehavior.entries.forEach { option ->
                    addView(RadioButton(context).apply {
                        this.id = View.generateViewId(); text = option.label; textSize = 14f
                        isChecked = option == directionBehavior
                        setOnCheckedChangeListener { _, checked -> if (checked) directionBehavior = option }
                    })
                }
            })
            content.addView(TextView(context).apply {
                text = "本次手势沿用起始按钮的设置；保持方向不会改变移入 / 移出震动。抬手、取消触控或切换场景都会释放。"; textSize = 13f
            })
        } else {
            content.addView(TextView(context).apply {
                text = "方向按钮支持滑动切换；固定 / 浮动摇杆使用相同的八向操作和死区设置。"; textSize = 13f
            })
        }
        if (key?.direction == true) {
            batchToggle = CheckBox(context).apply { isChecked = false }
            updateBatchLabel()
            content.addView(batchToggle)
            content.addView(TextView(context).apply {
                text = "勾选后，将当前大小、不透明度、进入 / 离开震动及强度、移出行为复制到本组方向按钮。不改变位置或其他布局；应用到草稿后仍需保存，可取消撤销。"; textSize = 13f
            })
        }
        val dialog = AlertDialog.Builder(context).setTitle("$label · 按键设置")
            .setView(ScrollView(context).apply { addView(content) })
            .setNegativeButton("取消", null)
            .setPositiveButton("应用到草稿") { _, _ ->
                if (draft === editingDraft) {
                    val edited = original.copy(scale = scale, slide = behavior, opacity = opacity,
                        enterVibration = enterVibration, leaveVibration = leaveVibration,
                        enterStrength = enterStrength, leaveStrength = leaveStrength, directionSlide = directionBehavior,
                        stickDiagonalVibration = stickDiagonalVibration, stickCardinalVibration = stickCardinalVibration,
                        stickDiagonalStrength = stickDiagonalStrength, stickCardinalStrength = stickCardinalStrength,
                        stickDeadZone = stickDeadZone, stickDeadZoneVibration = stickDeadZoneVibration,
                        stickDeadZoneStrength = stickDeadZoneStrength)
                    editingDraft.mergedButtons = mergedButtons
                    if (mergedButtons) {
                        val ids = selectedMode.buttonIds(if (id.startsWith("game/")) "game" else "menu")
                        editingDraft.applyStyles(ids, original, edited)
                    } else editingDraft.setStyle(id, edited)
                    if (canChangeMode) editingDraft.setStyle("game/stick", editingDraft.style("game/stick").copy(directionLayout =
                        if (mergedButtons) DirectionLayoutMode.MERGED else DirectionLayoutMode.INDIVIDUAL))
                    batchToggle?.takeIf { it.isEnabled && it.isChecked }?.let {
                        editingDraft.setDirectionStyles(if (id.startsWith("game/")) "game" else "menu", batchMode(), editingDraft.style(id))
                    }
                    if (canChangeMode) editingDraft.setStyle("game/stick", editingDraft.style("game/stick").copy(
                        directionMode = selectedMode, stickDisplay = stickDisplay))
                    rebuild()
                }
            }.create()
        styleDialog = dialog
        val previewFocus = android.view.ViewTreeObserver.OnWindowFocusChangeListener { focused ->
            if (!focused) vibrationPreview.setActive(false)
        }
        dialog.setOnDismissListener {
            vibrationPreview.setActive(false)
            dialog.window?.decorView?.viewTreeObserver?.takeIf { it.isAlive }
                ?.removeOnWindowFocusChangeListener(previewFocus)
            if (styleDialog === dialog) styleDialog = null
        }
        dialog.show()
        dialog.window?.decorView?.viewTreeObserver?.addOnWindowFocusChangeListener(previewFocus)
    }

    private fun beginDrag(pointer: Int, id: String, center: ControlPoint, x: Float, y: Float) {
        val centers = if (draft?.mergedButtons == true && id.startsWith("$layoutGroup/dpad/")) editableCenters()
            else if (id == "game/stick" && floating) emptyMap() else mapOf(id to center)
        drag = Drag(pointer, id, centers,
            centers.mapValues { (key, _) -> draft?.get(key) }, x, y)
    }

    /** Editor gestures are never passed to SDL, even while changing preview tabs. */
    private fun editTouch(event: MotionEvent): Boolean {
        val index = event.actionIndex
        val id = event.getPointerId(index)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val x = event.getX(index); val y = event.getY(index)
                val key = keyAt(x, y)
                if (key != null && key.id.startsWith("fixed/")) editorCommand = id to key.action.binding
                else if (key != null) beginDrag(id, key.id, ControlPoint(key.rect.centerX(), key.rect.centerY()), x, y)
                else if (profile.stick && (hypot(x - cx, y - cy) <= radius ||
                    floating && StickInput.contains(floatingArea, ControlPoint(x, y))))
                    beginDrag(id, "game/stick", ControlPoint(cx, cy), x, y)
            }
            MotionEvent.ACTION_POINTER_DOWN -> { cancelDrag(); rebuild() }
            MotionEvent.ACTION_MOVE -> drag?.let {
                val p = event.findPointerIndex(it.pointer)
                if (p >= 0) moveDrag(event.getX(p), event.getY(p))
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
                if (drag?.pointer == id) {
                    moveDrag(event.getX(index), event.getY(index))
                    val finished = drag
                    drag = null
                    if (finished != null && !finished.moved) editStyle(finished.id)
                }
                val command = editorCommand?.takeIf { it.first == id }?.second
                if (editorCommand?.first == id) editorCommand = null
                if (command != null && keys.any { it.id == "fixed/$command" && it.rect.contains(event.getX(index), event.getY(index)) }) {
                    when (command) {
                        "SaveLayout" -> finishEditing(save = true)
                        "CancelLayout" -> finishEditing(save = false)
                        "SwitchLayout" -> { cancelDrag(); editingGame = !editingGame; rebuild() }
                        "ResetLayout" -> {
                            resetDialog = AlertDialog.Builder(context).setTitle("恢复默认按键设置？")
                                .setMessage("将重置当前屏幕方向的位置、大小、方向模式、滑出行为、震动和不透明度。点击保存后生效；取消编辑仍可撤销。")
                                .setNegativeButton("保留", null)
                                .setPositiveButton("恢复默认") { _, _ -> draft?.reset(); rebuild() }.show()
                        }
                    }
                }
                performClick()
            }
            MotionEvent.ACTION_CANCEL -> { cancelDrag(); rebuild() }
        }
        invalidate()
        return true
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (editing) return editTouch(event)
        if (directSequence) return directTouch(event)
        if (direct && event.actionMasked == MotionEvent.ACTION_DOWN && keyAt(event.x, event.y) == null) {
            directSequence = true
            directPointer = event.getPointerId(0)
            directStartTime = event.eventTime
            val scene = state.touch!!
            val screen = ControlPoint(event.x / width, event.y / height)
            if (scene.viewport.contains(screen)) {
                val point = scene.viewport.local(screen)
                val target = scene.hit(point)
                if (target != null) {
                    directGesture = DirectGesture(scene, target, point, width * scene.viewport.w, height * scene.viewport.h,
                        ViewConfiguration.get(context).scaledTouchSlop.toFloat())
                }
            }
            return true
        }
        val index = event.actionIndex
        val id = event.getPointerId(index)
        if (event.actionMasked == MotionEvent.ACTION_DOWN && !buttons && !joystick &&
            keys.none { it.rect.contains(event.getX(index), event.getY(index)) }) return false
        // Contact feedback is geometric, not based on keycode pulses or latched actions.
        // Sample before release actions can open a dialog or change the profile.
        var vibrationStrength = updateContacts(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                val x = event.getX(index); val y = event.getY(index)
                val key = keyAt(x, y)
                if (key != null) {
                    if (key.direction && profile.menuDirections) {
                        // Fast alternating menu taps stay cardinal even while
                        // the previous direction's minimum pulse is pending.
                        keys.filter { it.direction }.forEach { directionKey -> directionKey.codes.forEach { pulses.remove(it) } }
                    }
                    if (slideAction(key)) actionPointers[id] = ActionSlideGesture(key.id, style(key.id).slide)
                    else pointers[id] = key
                    if (key.direction) directionPointers[id] = DirectionSlideGesture(key.id, style(key.id).directionSlide)
                } else if (profile.stick && stickGesture.begin(id, ControlPoint(x, y),
                        if (floating) null else stickCenter, floatingArea, radius)) {
                    vibrationStrength = max(vibrationStrength, updateStick(x, y))
                }
                // Own the gesture, including fingers initially outside a control.
                // Otherwise a second finger cannot press jump while the first rests on screen.
            }
            MotionEvent.ACTION_MOVE -> {
                val i = event.findPointerIndex(stickPointer)
                if (i >= 0) vibrationStrength = max(vibrationStrength, updateStick(event.getX(i), event.getY(i)))
                for ((pointer, gesture) in directionPointers) {
                    val p = event.findPointerIndex(pointer)
                    if (p < 0) continue
                    val target = keyAt(event.getX(p), event.getY(p))?.takeIf { it.direction }
                    gesture.move(target?.id)
                    val held = keys.firstOrNull { it.id == gesture.active() }
                    if (held == null) pointers.remove(pointer) else pointers[pointer] = held
                }
                for ((pointer, gesture) in actionPointers) {
                    val p = event.findPointerIndex(pointer)
                    if (p >= 0) gesture.move(keyAt(event.getX(p), event.getY(p))?.takeIf { slideAction(it) }?.id)
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
                val key = pointers.remove(id)
                finishPress(key)
                actionPointers.remove(id)?.active()?.forEach { actionId ->
                    finishPress(keys.firstOrNull { it.id == actionId })
                }
                directionPointers -= id
                if (stickGesture.end(id)) { sx = 0f; sy = 0f; stickFeedback.clear() }
                if (key?.rect?.contains(event.getX(index), event.getY(index)) == true) {
                    if (key.action.binding == "Exit") { releaseAll(); onExit() }
                    if (key.action.binding == "Keyboard") {
                        releaseAll()
                        val target = state.touch?.targets?.firstOrNull { it.id == "text" }
                        if (direct && target != null) showTextEditor(state.touch!!, target) else onKeyboard()
                    }
                    if (key.action.binding == "Edit") startEditing()
                    if (key.action.binding == "ToggleTouch") {
                        releaseAll(); directPreferred = !directPreferred
                        preferences.edit().putBoolean("direct-touch", directPreferred).apply()
                        rebuild()
                    }
                }
                performClick()
            }
            MotionEvent.ACTION_CANCEL -> releaseAll()
        }
        syncKeys(); vibrate(vibrationStrength); invalidate()
        return true
    }
    override fun performClick(): Boolean { super.performClick(); return true }
    private fun updateContacts(event: MotionEvent): Int {
        if (event.actionMasked == MotionEvent.ACTION_CANCEL) { contacts.clear(); return 0 }
        val lifted = if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_POINTER_UP)
            event.actionIndex else -1
        val touching = buildSet {
            for (i in 0 until event.pointerCount) {
                if (i == lifted) continue
                val x = event.getX(i); val y = event.getY(i)
                val key = keyAt(x, y)
                if (key != null) {
                    if (!key.id.startsWith("fixed/")) add(key.id)
                } else if (profile.stick) {
                    val startsFloating = floating && stickPointer == -1 && i == event.actionIndex &&
                        event.actionMasked in setOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN) &&
                        StickInput.contains(floatingArea, ControlPoint(x, y))
                    if (startsFloating || ((!floating || event.getPointerId(i) == stickPointer) &&
                        hypot(x - cx, y - cy) <= radius * 1.3f)) add("game/stick")
                }
            }
        }
        val changes = contacts.update(touching)
        // Merge simultaneous transitions; one motor cannot play separate effects at once.
        return changes.maxOfOrNull { style(it.id).vibrationStrength(it.entering) } ?: 0
    }
    private fun vibrate(strength: Int) {
        if (strength <= 0) return
        onVibration(strength)
    }
    private fun directTouch(event: MotionEvent): Boolean {
        val scene = state.touch
        when (event.actionMasked) {
            MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_CANCEL -> {
                directGesture = null // No two-finger tap/drag can accidentally confirm a menu.
                if (event.actionMasked == MotionEvent.ACTION_CANCEL) directSequence = false
            }
            MotionEvent.ACTION_MOVE -> {
                val index = event.findPointerIndex(directPointer)
                if (index >= 0 && scene != null) {
                    val point = scene.viewport.local(ControlPoint(event.getX(index) / width, event.getY(index) / height))
                    directGesture?.move(point)?.let { touchWriter.send(it) }
                }
            }
            MotionEvent.ACTION_UP -> {
                val gesture = directGesture
                if (gesture != null && scene != null) {
                    val point = scene.viewport.local(ControlPoint(event.x / width, event.y / height))
                    gesture.finish(point, scene, event.eventTime - directStartTime)?.let {
                        if (it.action == "keyboard") showTextEditor(scene, gesture.target) else touchWriter.send(it)
                    }
                }
                directGesture = null; directSequence = false; directPointer = -1
                performClick()
            }
        }
        return true
    }
    private fun showTextEditor(scene: TouchScene, target: TouchTarget) {
        if (textDialog?.isShowing == true) return
        releaseAll()
        val edit = EditText(context).apply {
            inputType = if (target.kind == "number") InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL or InputType.TYPE_NUMBER_FLAG_SIGNED
                else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            isSingleLine = true
            filters = arrayOf(InputFilter.LengthFilter(target.maxLength))
            setText(target.text); selectAll()
            setPadding((20 * density).toInt(), (12 * density).toInt(), (20 * density).toInt(), (12 * density).toInt())
        }
        textEpoch = scene.epoch
        val dialog = AlertDialog.Builder(context).setTitle(target.label.ifBlank { "输入文本" }).setView(edit)
            .setNegativeButton("取消", null)
            .setPositiveButton(when (scene.kind) { "search" -> "搜索"; "chat" -> "填入"; else -> "完成" }) { _, _ ->
                if (state.touch?.epoch == scene.epoch)
                    touchWriter.send(TouchIntent(scene.epoch, target.id, "text", text = edit.text.toString()))
            }.create()
        textDialog = dialog
        dialog.setOnDismissListener { textDialog = null; textEpoch = null }
        dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE or WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        dialog.show(); edit.requestFocus()
        dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
    }
    override fun onDetachedFromWindow() {
        releaseAll(); resetDialog?.dismiss(); resetDialog = null
        styleDialog?.dismiss(); styleDialog = null
        textDialog?.dismiss(); textDialog = null; touchWriter.close(); modWriter.close()
        super.onDetachedFromWindow()
    }
    fun releaseAll() {
        cancelDrag()
        contacts.clear()
        stickFeedback.clear()
        directGesture = null; directSequence = false; directPointer = -1
        handler.removeCallbacksAndMessages(null)
        for (code in down) if (code >= 0) SDLActivity.onNativeKeyUp(code)
        modWriter.set(state.modEpoch, emptyList())
        down.clear(); pulses.clear(); pressedAt.clear(); pointers.clear(); actionPointers.clear(); directionPointers.clear()
        stickGesture.clear(); sx = 0f; sy = 0f
        invalidate()
    }
}
