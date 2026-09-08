import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAutoDisableNewMods, useGamePath, reloadBlacklistState } from "../states";
import { useGlobalContext } from "../App";
import { showLocalPackageInstaller } from "./DropInstaller";
import { Icon } from "./Icon";

type RuntimeSettings = { gameRoot: string; runtime: string; buttons: boolean; joystick: boolean };

export function AndroidRuntime() {
  const [gamePath] = useGamePath();
  const [autoDisable] = useAutoDisableNewMods();
  const ctx = useGlobalContext();
  const [settings, setSettings] = useState<RuntimeSettings>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    invoke<RuntimeSettings>("android_runtime_settings").then(setSettings).catch(e => setError(String(e)));
  }, []);
  async function update(key: "buttons" | "joystick", value: boolean) {
    if (!settings) return;
    setSaving(true); setError("");
    try {
      setSettings(await invoke<RuntimeSettings>("android_runtime_settings", {
        buttons: key === "buttons" ? value : settings.buttons,
        joystick: key === "joystick" ? value : settings.joystick,
      }));
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }
  async function importPackage() {
    setSaving(true); setError("");
    try {
      const selected = await invoke<{ path: string } | null>("android_pick_package");
      if (selected) showLocalPackageInstaller([selected.path], gamePath, autoDisable, () => {
        void ctx.modManage.reloadMods().catch(console.error);
        void reloadBlacklistState(gamePath).catch(console.error);
        ctx.everest.updateEverestVersion();
      });
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }
  return <section className="settings-section android-runtime">
    <div className="settings-section-title"><Icon name="settings" /><span>Android 游戏运行时</span></div>
    <div className="settings-card">
      <div className="theme-setting">
        <div className="setting-description">
          <strong>{settings?.runtime ?? "正在读取运行时…"}</strong>
          <small>应用不含游戏资源。将自己的游戏放入下方目录的子文件夹，然后返回主页选择。</small>
          <code>{settings?.gameRoot}</code>
        </div>
        <button disabled={!gamePath || saving} onClick={() => void importPackage()}>导入 Mod / Everest ZIP</button>
      </div>
      <label className="setting-toggle-row">
        <span><strong>智能屏幕按键</strong><small>游玩时显示跳跃 / 冲刺 / 抓取，菜单自动切换确定 / 返回；跟随游戏键位，默认关闭。</small></span>
        <input type="checkbox" checked={settings?.buttons ?? false} disabled={!settings || saving}
          onChange={e => void update("buttons", e.target.checked)} />
      </label>
      <label className="setting-toggle-row">
        <span><strong>屏幕摇杆映射</strong><small>游玩时使用八向摇杆（18% 死区），菜单自动换为十字方向键和确认 / 返回，默认关闭。</small></span>
        <input type="checkbox" checked={settings?.joystick ?? false} disabled={!settings || saving}
          onChange={e => void update("joystick", e.target.checked)} />
      </label>
      <div className="theme-setting"><div className="setting-description">
        <small>设置在下次启动游戏时生效。两项均关闭时可使用实体手柄或键盘。游戏内安卓返回键 / 返回手势等同 Esc；左上角退出图标可返回管理器，启动过程中返回键可取消启动。</small>
        {error && <p role="alert">{error}</p>}
      </div></div>
    </div>
  </section>;
}
