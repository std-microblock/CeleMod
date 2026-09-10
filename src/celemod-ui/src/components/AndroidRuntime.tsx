import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAutoDisableNewMods, useGamePath, reloadBlacklistState } from "../states";
import { useGlobalContext } from "../App";
import { showLocalPackageInstaller } from "./DropInstaller";
import { Icon } from "./Icon";
import { SteamAccount } from "./SteamAccount";
import { AndroidLogs } from "./AndroidLogs";

type RuntimeSettings = { gameRoot: string; runtime: string; buttons: boolean; joystick: boolean; gameRumble: boolean };

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
  async function update(key: "buttons" | "joystick" | "gameRumble", value: boolean) {
    if (!settings) return;
    setSaving(true); setError("");
    try {
      setSettings(await invoke<RuntimeSettings>("android_runtime_settings", {
        [key]: value,
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
  return <><SteamAccount /><section className="settings-section android-runtime">
    <div className="settings-section-title"><Icon name="settings" /><span>Android 游戏运行时</span></div>
    <div className="settings-card">
      <AndroidLogs />
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
        <span><strong>屏幕方向控制</strong><small>默认使用固定八向摇杆；游戏内「编辑」可切换固定 / 浮动摇杆、四键 / 八键按钮，选择八分圆环显示，调整死区及震动。支持合并按钮一起编辑、最大 300% 大小和中心点限位。菜单使用四向方向键，默认关闭。</small></span>
        <input type="checkbox" checked={settings?.joystick ?? false} disabled={!settings || saving}
          onChange={e => void update("joystick", e.target.checked)} />
      </label>
      <div className="theme-setting"><div className="setting-description">
        <small>设置在下次启动游戏时生效。屏幕按键和方向控制均关闭时可使用实体手柄或键盘。游戏内安卓返回键 / 返回手势等同 Esc；左上角退出图标可返回管理器，启动过程中返回键可取消启动。</small>
        <small>游戏内点左上角「编辑」，再轻点摇杆 / 方向键切换模式，轻点各按钮设置进入 / 离开震动、独立震动强度和不透明度（Opacity）；保存后生效，横竖屏分别记忆。</small>
        {error && <p role="alert">{error}</p>}
      </div></div>
      <label className="setting-toggle-row">
        <span><strong>跟随游戏震动</strong><small>将原游戏的手柄震动输出转为手机震动，无需连接手柄，默认关闭。保留游戏内震动强弱设置；游戏内关闭震动时不触发。与按键进入 / 离开震动独立，切后台或退出会停止。</small></span>
        <input type="checkbox" checked={settings?.gameRumble ?? false} disabled={!settings || saving}
          onChange={e => void update("gameRumble", e.target.checked)} />
      </label>
    </div>
  </section></>;
}
