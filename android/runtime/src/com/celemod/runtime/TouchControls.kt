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
    private val onKeyboard: () -> Unit
) : View(context) {
    private data class Key(val id: String, val action: ControlAction, val codes: Set<Int>, val rect: RectF,
                           val direction: Boolean = false, val iconOnly: Boolean = false)
    private data class Drag(val pointer: Int, val id: String, val offsetX: Float, val offsetY: Float,
                            val halfWidth: Float, val halfHeight: Float, val original: ControlPoint?,
                            val startX: Float, val startY: Float, var moved: Boolean = false)
    private val keys = mutableListOf<Key>()
    private val pointers = linkedMapOf<Int, Key>()
    private val actionPointers = linkedMapOf<Int, ActionSlideGesture>()
    private val directionPointers = mutableSetOf<Int>()
    private val down = mutableSetOf<Int>()
    private val pulses = mutableMapOf<Int, Any>()
    private val pressedAt = mutableMapOf<Int, Long>()
    private val handler = Handler(Looper.getMainLooper())
    private var state = ControlState()
    private var profile = ControlProfile.forState(state, buttons, joystick)
    private var stickPointer = -1
    private var sx = 0f
    private var sy = 0f
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val density = resources.displayMetrics.density
    private val safe = Rect()
    private val preferences = context.getSharedPreferences("touch-layouts", Context.MODE_PRIVATE)
    private val touchWriter = DirectTouchWriter(context.cacheDir)
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
    private var draft: ControlLayoutDraft? = null
    private var editingGame = true
    private var drag: Drag? = null
    private var editorCommand: Pair<Int, String>? = null
    private var resetDialog: AlertDialog? = null
    private var styleDialog: AlertDialog? = null
    private val editing get() = draft != null
    private var stickCenter = ControlPoint(0f, 0f)
    private var layoutBounds = ControlBounds(0f, 0f, 0f, 0f)
    private var toolbarBounds = ControlBounds(0f, 0f, 0f, 0f)
    private val radius get() = min(
        min((height - safe.top - safe.bottom) * .18f, 75 * density) * style("game/stick").scale,
        min(layoutBounds.width, layoutBounds.height) / 2)
    private val cx get() = stickCenter.x
    private val cy get() = stickCenter.y

    private fun gameLayout(mode: ControlMode) = mode in setOf(ControlMode.GAMEPLAY, ControlMode.PICO8, ControlMode.FALLBACK)
    private val layoutGroup get() = if (if (editing) editingGame else gameLayout(state.mode)) "game" else "menu"
    private fun style(id: String) = if (editing) draft!!.style(id) else savedStyles[id] ?: ControlStyle()
    private fun slideAction(key: Key) = key.id.startsWith("game/action/")
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
            state.touch?.epoch != next.touch?.epoch)
            releaseAll()
        state = next
        profile = ControlProfile.forState(state, buttons, joystick, direct)
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
        layoutBounds = ControlBounds(safe.left + margin, safe.top + margin, w - margin, h - margin)
        val toolbarCount = if (editing) 4 else if (buttons || joystick) 3 else 2
        toolbarBounds = ControlBounds(safe.left.toFloat(), safe.top.toFloat(),
            safe.left + margin + toolbarCount * (topSize + margin), safe.top + topSize + 2 * margin)
        profile = if (!editing) ControlProfile.forState(state, buttons, joystick, direct)
            else if (editingGame) ControlProfile.forState(ControlState(ControlMode.GAMEPLAY, canTalk = true), true, joystick)
            else ControlProfile.forState(ControlState(ControlMode.PAUSE), true, false).let {
                it.copy(actions = it.actions + ControlAction("Pause", "完成", ControlIcon.CONFIRM),
                    auxiliary = ControlAction("MenuJournal", "日志", ControlIcon.BOOK))
            }
        fun key(id: String, action: ControlAction, x: Float, y: Float, side: Float = size,
                direction: Boolean = false, iconOnly: Boolean = false) {
            val actualSide = if (id.startsWith("fixed/")) side else
                (side * style(id).scale).coerceAtMost(min(layoutBounds.width, layoutBounds.height))
            val center = if (id.startsWith("fixed/")) ControlPoint(x + side / 2, y + side / 2)
                else place(id, ControlPoint(x + side / 2, y + side / 2), actualSide / 2, actualSide / 2)
            keys += Key(id, action, ControlKeys.resolveAll(state, action.binding),
                RectF(center.x - actualSide / 2, center.y - actualSide / 2,
                    center.x + actualSide / 2, center.y + actualSide / 2), direction, iconOnly)
        }
        // Fixed controls cannot be dragged off screen or covered by custom controls.
        val toolbar = if (editing) listOf(
            ControlAction("SaveLayout", "保存", ControlIcon.CONFIRM),
            ControlAction("CancelLayout", "取消", ControlIcon.CLOSE),
            ControlAction("ResetLayout", "重置", ControlIcon.RESET),
            ControlAction("SwitchLayout", if (editingGame) "到菜单" else "到游戏")
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
        if (profile.directions) {
            val step = size + margin * .25f
            val left = safe.left + margin
            val bottom = h - size - margin
            val prefix = if (profile.menuDirections) "Menu" else ""
            key("$layoutGroup/dpad/Left", ControlAction(prefix + "Left", "左", ControlIcon.LEFT), left, bottom - step, direction = true, iconOnly = true)
            key("$layoutGroup/dpad/Down", ControlAction(prefix + "Down", "下", ControlIcon.DOWN), left + step, bottom, direction = true, iconOnly = true)
            key("$layoutGroup/dpad/Right", ControlAction(prefix + "Right", "右", ControlIcon.RIGHT), left + 2 * step, bottom - step, direction = true, iconOnly = true)
            key("$layoutGroup/dpad/Up", ControlAction(prefix + "Up", "上", ControlIcon.UP), left + step, bottom - 2 * step, direction = true, iconOnly = true)
        }
        stickCenter = place("game/stick", ControlPoint(safe.left + radius + 26 * density,
            height - safe.bottom - radius - 25 * density), radius, radius)
        contentDescription = if (editing) "布局编辑：拖动调整位置，轻点设置大小和滑出行为；左上角保存、取消、重置、切换布局"
            else "游戏触控：${state.mode.name}；左上角编辑布局、返回管理器"
        invalidate()
    }

    private fun place(id: String, default: ControlPoint, halfWidth: Float, halfHeight: Float): ControlPoint {
        val position = if (editing) draft?.get(id) else savedPositions[id]
        // Leave untouched default positions alone outside the editor.
        if (position == null && !editing && style(id).scale == 1f) return default
        val center = position?.let { ControlLayout.project(it, layoutBounds) } ?: default
        return ControlLayout.constrain(center, halfWidth, halfHeight, layoutBounds, toolbarBounds)
    }

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
                    else -> "直接点选 · 滑动列表 · 左上角可切回按键"
                }
                canvas.drawText(hint, width / 2f, height - safe.bottom - 8 * density, paint)
                postInvalidateDelayed(2500)
            }
        }
        if (editing) canvas.drawColor(0x66000000)
        if (profile.stick) {
            paint.style = Paint.Style.FILL
            paint.color = if (drag?.id == "game/stick") 0x9982B8FF.toInt() else 0x66313E51
            canvas.drawCircle(cx, cy, radius, paint)
            paint.color = 0xAA82B8FF.toInt()
            canvas.drawCircle(cx + sx * radius * .65f, cy + sy * radius * .65f, radius * .35f, paint)
            if (editing) {
                paint.style = Paint.Style.STROKE; paint.strokeWidth = 2 * density; paint.color = Color.WHITE
                canvas.drawCircle(cx, cy, radius, paint)
            }
        }
        val heldActions = heldActionKeys().map { it.id }.toSet()
        for (key in keys) {
            paint.style = Paint.Style.FILL
            paint.color = if (key.codes.any { it in down } || key in pointers.values || key.id in heldActions || drag?.id == key.id)
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
                val y = if (key.action.icon == ControlIcon.NONE) key.rect.centerY() else key.rect.top + key.rect.height() * .76f
                canvas.drawText(key.action.label, key.rect.centerX(), y - (paint.ascent() + paint.descent()) / 2, paint)
            }
        }
        if (editing) {
            paint.style = Paint.Style.FILL
            paint.color = Color.WHITE; paint.textAlign = Paint.Align.CENTER; paint.textSize = 13 * density
            val hint = "${if (editingGame) "游戏" else "菜单"}布局 · 拖动调整位置 · 轻点设置大小 / 滑出行为 · 保存后生效"
            canvas.drawText(hint, width / 2f, toolbarBounds.bottom + 20 * density, paint)
        }
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
        if (sx != 0f || sy != 0f) {
            if (abs(sx) >= abs(sy) * .41421356f)
                next += ControlKeys.resolveAll(state, if (sx < 0) "Left" else "Right")
            if (abs(sy) >= abs(sx) * .41421356f)
                next += ControlKeys.resolveAll(state, if (sy < 0) "Up" else "Down")
        }
        for (code in down - next) { SDLActivity.onNativeKeyUp(code); pressedAt.remove(code) }
        for (code in next - down) { SDLActivity.onNativeKeyDown(code); pressedAt[code] = SystemClock.uptimeMillis() }
        down.clear(); down.addAll(next)
    }
    private fun updateStick(x: Float, y: Float) {
        val dx = (x - cx) / radius
        val dy = (y - cy) / radius
        val length = sqrt(dx * dx + dy * dy)
        sx = if (length < .18f) 0f else dx / max(1f, length)
        sy = if (length < .18f) 0f else dy / max(1f, length)
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
        draft = ControlLayoutDraft(savedPositions, savedStyles)
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
            preferences.edit().putString(orientation, ControlLayout.encode(savedPositions))
                .putString("$orientation/styles", ControlStyle.encode(savedStyles)).apply()
        }
        draft = null
        resetDialog?.dismiss(); resetDialog = null
        styleDialog?.dismiss(); styleDialog = null
        rebuild()
        Toast.makeText(context, if (save) "按键布局已保存" else "已取消，保留原布局", Toast.LENGTH_SHORT).show()
    }

    private fun cancelDrag() {
        drag?.let { draft?.restore(it.id, it.original) }
        drag = null; editorCommand = null
    }

    private fun moveDrag(x: Float, y: Float) {
        val target = drag ?: return
        if (!target.moved && hypot(x - target.startX, y - target.startY) <= ViewConfiguration.get(context).scaledTouchSlop) return
        target.moved = true
        val point = ControlLayout.constrain(ControlPoint(x - target.offsetX, y - target.offsetY),
            target.halfWidth, target.halfHeight, layoutBounds, toolbarBounds)
        draft?.move(target.id, ControlLayout.normalize(point, layoutBounds))
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
        val padding = (20 * density).toInt()
        val content = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding / 2, padding, padding / 2)
        }
        val sizeLabel = TextView(context).apply { text = "大小：${(scale * 100).roundToInt()}%"; textSize = 16f }
        content.addView(sizeLabel)
        content.addView(SeekBar(context).apply {
            max = 30; progress = ((scale * 100 - 50) / 5).roundToInt()
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(bar: SeekBar?, value: Int, fromUser: Boolean) {
                    scale = (50 + value * 5) / 100f
                    sizeLabel.text = "大小：${50 + value * 5}%"
                }
                override fun onStartTrackingTouch(bar: SeekBar?) = Unit
                override fun onStopTrackingTouch(bar: SeekBar?) = Unit
            })
        }, LinearLayout.LayoutParams(-1, -2))
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
        } else {
            content.addView(TextView(context).apply {
                text = "方向键保留滑动切换，摇杆保留摇杆操作。"; textSize = 13f
            })
        }
        val dialog = AlertDialog.Builder(context).setTitle("$label · 按键设置")
            .setView(ScrollView(context).apply { addView(content) })
            .setNegativeButton("取消", null)
            .setPositiveButton("应用到草稿") { _, _ ->
                if (draft === editingDraft) { editingDraft.setStyle(id, ControlStyle(scale, behavior)); rebuild() }
            }.create()
        styleDialog = dialog
        dialog.setOnDismissListener { if (styleDialog === dialog) styleDialog = null }
        dialog.show()
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
                else if (key != null) drag = Drag(id, key.id, x - key.rect.centerX(), y - key.rect.centerY(),
                    key.rect.width() / 2, key.rect.height() / 2, draft?.get(key.id), x, y)
                else if (profile.stick && hypot(x - cx, y - cy) <= radius) drag =
                    Drag(id, "game/stick", x - cx, y - cy, radius, radius, draft?.get("game/stick"), x, y)
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
                                .setMessage("将重置当前屏幕方向的位置、大小和滑出行为。点击保存后生效；取消编辑仍可撤销。")
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
                    if (key.direction) directionPointers += id
                } else if (profile.stick && stickPointer == -1 && hypot(x - cx, y - cy) <= radius * 1.3f) {
                    stickPointer = id; updateStick(x, y)
                }
                // Own the gesture, including fingers initially outside a control.
                // Otherwise a second finger cannot press jump while the first rests on screen.
            }
            MotionEvent.ACTION_MOVE -> {
                val i = event.findPointerIndex(stickPointer)
                if (i >= 0) updateStick(event.getX(i), event.getY(i))
                for (pointer in directionPointers) {
                    val p = event.findPointerIndex(pointer)
                    if (p < 0) continue
                    val key = keys.lastOrNull { it.direction && it.rect.contains(event.getX(p), event.getY(p)) }
                    if (key == null) pointers.remove(pointer) else pointers[pointer] = key
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
                if (id == stickPointer) { stickPointer = -1; sx = 0f; sy = 0f }
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
        syncKeys(); invalidate()
        return true
    }
    override fun performClick(): Boolean { super.performClick(); return true }
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
            .setPositiveButton(if (scene.kind == "search") "搜索" else "完成") { _, _ ->
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
        textDialog?.dismiss(); textDialog = null; touchWriter.close()
        super.onDetachedFromWindow()
    }
    fun releaseAll() {
        cancelDrag()
        directGesture = null; directSequence = false; directPointer = -1
        handler.removeCallbacksAndMessages(null)
        for (code in down) SDLActivity.onNativeKeyUp(code)
        down.clear(); pulses.clear(); pressedAt.clear(); pointers.clear(); actionPointers.clear(); directionPointers.clear()
        stickPointer = -1; sx = 0f; sy = 0f
        invalidate()
    }
}
