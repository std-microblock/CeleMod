import { useEffect, useRef, useState } from "react";
import { useCurrentLang, useGamePath } from "../states";
import { callRemote } from "../utils";
import _i18n from "../i18n";
import { actionKey, supportsTouch, toggleTouchAction, touchButtonError, TOUCH_ICONS, type TouchButton, type TouchEntry } from "./touchButtons";
import { TouchButtonIcon } from "./TouchButtonIcon";
import "./AndroidKeyBindings.scss";

interface Catalog { entries: TouchEntry[]; touchButtons: TouchButton[] }
const labelOf = (entry: TouchEntry) => entry.sourceKind === "game" ? _i18n.t(`binding_${entry.action}`) : entry.label;

export function AndroidKeyBindings() {
  const [gamePath] = useGamePath();
  const { currentLang } = useCurrentLang();
  const [catalog, setCatalog] = useState<Catalog>({ entries: [], touchButtons: [] });
  const [draft, setDraft] = useState<TouchButton>();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("*");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [deleting, setDeleting] = useState<string>();
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    const request = ++generation.current;
    setDraft(undefined); setDeleting(undefined); setError(""); setNotice(""); setLoading(true); setLoaded(false);
    setCatalog({ entries: [], touchButtons: [] });
    if (!gamePath) { setLoading(false); return; }
    void callRemote<Catalog>("get_key_bindings", gamePath, currentLang).then(data => {
      if (request === generation.current) { setCatalog(data); setLoaded(true); }
    }).catch(reason => { if (request === generation.current) setError(String(reason)); })
      .finally(() => { if (request === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [gamePath, currentLang, reload]);
  async function save(buttons: TouchButton[]) {
    if (busy.current) return;
    busy.current = true; setSaving(true); setError(""); setNotice("");
    const request = generation.current;
    try {
      await callRemote("save_touch_buttons", gamePath, buttons);
      if (request !== generation.current) return;
      setCatalog(current => ({ ...current, touchButtons: buttons }));
      setDraft(undefined); setDeleting(undefined); setNotice("已保存，下次启动游戏生效");
    } catch (reason) { if (request === generation.current) setError(String(reason)); }
    finally { busy.current = false; setSaving(false); }
  }
  const entries = catalog.entries;
  const lookup = new Map(entries.map(entry => [actionKey(entry), entry]));
  const selected = new Set(draft?.actions.map(actionKey));
  const matches = entries.filter(entry => (source === "*" || entry.source === source) &&
    `${entry.source} ${labelOf(entry)} ${entry.actionPath} ${entry.description ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const available = entries.filter(entry => supportsTouch(entry) && entry.enabled && entry.installed).length;
  function edit(button?: TouchButton) {
    setDraft(button ? { ...button, actions: [...button.actions] } : {
      id: crypto.randomUUID(), label: "", enabled: true, actions: [], icon: "NONE",
    });
    setQuery(""); setSource("*"); setNotice(""); setError(""); setDeleting(undefined);
  }
  return <main className="android-keybindings">
    <header><h2>虚拟按键</h2><button disabled={loading || saving || !!draft} onClick={() => setReload(value => value + 1)}>刷新功能</button></header>
    {!draft && <><p>一个文字或图标按钮可同时触发一个或多个 Mod 功能，无需键盘或手柄，不修改原有键位。</p>
    <p className="touch-help">创建后在游戏左上角「编辑」中拖动按钮，轻点调整大小、滑出行为、震动和透明度。自定义按钮独立于默认屏幕按键开关；菜单和游玩布局分别调整。</p></>}
    {error && <div role="alert" className="touch-error">{error}</div>}
    {notice && <div role="status" className="touch-notice">{notice}</div>}
    {!gamePath ? <p>请先选择游戏目录。</p> : loading ? <p role="status">正在读取 Mod 功能…</p> : <>
      {draft ? <section className="touch-button-editor" aria-label="编辑虚拟按键">
        <h3>{catalog.touchButtons.some(button => button.id === draft.id) ? "编辑按键" : "新建按键"}</h3>
        <label className="touch-name">按钮名称<input value={draft.label} maxLength={16} placeholder="例如：聊天 / 工具组合" disabled={saving} onChange={event => setDraft({ ...draft, label: event.target.value })} /></label>
        <fieldset className="touch-icon-picker" disabled={saving}><legend>显示样式：文字或图标</legend>
          <div className="touch-icon-options">{TOUCH_ICONS.map(([icon, name]) => <button type="button" key={icon} aria-label={`${name}样式`} aria-pressed={(draft.icon ?? "NONE") === icon}
            onClick={() => setDraft({ ...draft, icon })}><TouchButtonIcon icon={icon} label="Aa" /><small>{name}</small></button>)}</div>
          <div className="touch-icon-preview"><span>游戏内预览</span><div><TouchButtonIcon icon={draft.icon} label={draft.label} /></div></div>
        </fieldset>
        <div className="touch-selected"><strong>已选 {draft.actions.length}/16 个功能</strong>
          {draft.actions.map(action => {
            const entry = lookup.get(actionKey(action));
            return <button key={actionKey(action)} disabled={saving} onClick={() => setDraft({ ...draft, actions: toggleTouchAction(draft.actions, action) })}>
              {action.source} · {entry ? labelOf(entry) : action.actionPath} ×
            </button>;
          })}
        </div>
        <div className="touch-filters">
          <input type="search" aria-label="搜索 Mod 功能" placeholder="搜索 Mod 或功能" value={query} onChange={event => setQuery(event.target.value)} />
          <select aria-label="筛选 Mod" value={source} onChange={event => setSource(event.target.value)}><option value="*">全部 Mod / 游戏</option>
            {[...new Set(entries.map(entry => entry.source))].sort().map(name => <option key={name}>{name}</option>)}
          </select>
        </div>
        <div className="touch-action-list">
          {matches.map(entry => {
            const checked = selected.has(actionKey(entry));
            const reason = !supportsTouch(entry) ? "该旧式组合键 / 方向轴不支持直接触发" : !entry.installed ? "Mod 未安装" : !entry.enabled ? "Mod 已禁用" : "";
            return <label key={actionKey(entry)} className={reason ? "unavailable" : ""}>
              <input type="checkbox" checked={checked} disabled={saving || !checked && (!!reason || draft.actions.length >= 16)}
                onChange={() => setDraft({ ...draft, actions: toggleTouchAction(draft.actions, entry) })} />
              <span><strong>{labelOf(entry)}</strong><small>{entry.source} · {entry.actionPath}</small>{entry.description && <small>{entry.description}</small>}{reason && <small>{reason}</small>}</span>
            </label>;
          })}
          {!matches.length && <p>没有匹配的功能。新安装的 Mod 通常需要先启动游戏一次以生成设置。</p>}
        </div>
        <footer><span>{touchButtonError(draft) || "所选功能将同时按下 / 松开"}</span>
          <button disabled={saving} onClick={() => { setDraft(undefined); setError(""); }}>取消</button>
          <button disabled={saving || !!touchButtonError(draft)} onClick={() => void save([
            ...catalog.touchButtons.filter(button => button.id !== draft.id), { ...draft, label: draft.label.trim() },
          ])}>{saving ? "保存中…" : "保存按键"}</button>
        </footer>
      </section> : <>
        <div className="touch-summary"><span>{catalog.touchButtons.length}/24 个按钮 · {available} 个可绑定功能</span><button disabled={saving || !loaded || catalog.touchButtons.length >= 24} onClick={() => edit()}>＋ 新建虚拟按键</button></div>
        {!catalog.touchButtons.length && <section className="touch-empty"><h3>把 Mod 功能放到屏幕上</h3><p>新建按钮 → 勾选功能 → 保存 → 启动游戏调整位置。</p><small>如果功能没有出现，请先启动一次装有该 Mod 的游戏，再回来刷新。</small></section>}
        {catalog.touchButtons.map(button => <section className="touch-button-card" key={button.id}>
          <div className="touch-button-title"><div className="touch-card-name"><div className="touch-card-icon"><TouchButtonIcon icon={button.icon} label={button.label} /></div><strong>{button.label}</strong></div><label><input type="checkbox" checked={button.enabled} disabled={saving} onChange={() => void save(catalog.touchButtons.map(item => item.id === button.id ? { ...item, enabled: !item.enabled } : item))} />显示</label></div>
          <ul>{button.actions.map(action => { const entry = lookup.get(actionKey(action)); return <li key={actionKey(action)}>{action.source} · {entry ? labelOf(entry) : action.actionPath}{!entry || !entry.enabled || !entry.installed ? "（当前不可用，保留绑定）" : ""}</li>; })}</ul>
          {deleting === button.id ? <div className="touch-card-actions"><span>删除此虚拟按键？不会修改 Mod 设置。</span><button disabled={saving} onClick={() => setDeleting(undefined)}>取消</button><button disabled={saving} onClick={() => void save(catalog.touchButtons.filter(item => item.id !== button.id))}>确认删除</button></div>
            : <div className="touch-card-actions"><button disabled={saving} onClick={() => edit(button)}>编辑功能</button><button disabled={saving} onClick={() => setDeleting(button.id)}>删除</button></div>}
        </section>)}
      </>}
    </>}
  </main>;
}
