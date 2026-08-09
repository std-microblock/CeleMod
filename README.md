[English](./README.en.md)

<div align=center>
<img src="src/celemod-ui/src/resources/Celemod.png" width="96" alt="CeleMod logo" />

# CeleMod

[Github](https://github.com/MicroCBer/CeleMod/releases/latest) · [蓝奏云 (密码·ok)](https://microblock.lanzouo.com/b0apezvij)

An alternative mod manager for Celeste  
 一个 ⌈ 更好用、更强大 ⌋ 的蔚蓝 Mod 管理器

</div>

### 好用

✅ 常用 Mod 列表，一键安装  
✅ 国内超快下载（多线程下载，@WEGFan 镜像）  
✅ 基于 Tauri 2 的跨平台桌面应用  
✅ 一键解析，补全依赖  
✅ 一键升级 Mod  
✅ 按类别搜索，多种排序方式  
✅ 国服联机 Celeste.Miao.Net 快速配置  
✅ Everest 镜像一键安装

### 强大

✅ 多个 Mod 配置一键切换  
✅ 树状 Mod 管理，依赖一目了然  
✅ 多个 Mod 同时下载，不阻塞  
✅ 软件内 Mod 详情预览  
✅ 原生 WebView + React UI

### 页面展示

<table>
  <tr>
    <td><img src="docs/screenshots/home.webp" alt="CeleMod 主页" /><br /><b>主页与 Profile</b></td>
    <td><img src="docs/screenshots/discover.webp" alt="CeleMod 社区搜索" /><br /><b>社区 Mod 搜索</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/manager.webp" alt="CeleMod Mod 管理" /><br /><b>树状 Mod 管理</b></td>
    <td><img src="docs/screenshots/keybindings.webp" alt="CeleMod 按键管理" /><br /><b>按键管理</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/multiplayer.webp" alt="CeleMod 群服联机" /><br /><b>群服联机配置</b></td>
    <td><img src="docs/screenshots/recommended.webp" alt="CeleMod 推荐模组" /><br /><b>推荐模组</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/skins.webp" alt="CeleMod 皮肤推荐" /><br /><b>皮肤浏览</b></td>
    <td><img src="docs/screenshots/settings.webp" alt="CeleMod 设置" /><br /><b>完整设置</b></td>
  </tr>
</table>

### Credits

[@WEGFan](https://github.com/WEGFan) 提供镜像和社区 API、蔚蓝实现等相关知识

### 开发

CeleMod 使用 Tauri 2、React、Zustand 和 Immer。需要 Node.js 20+、pnpm、Rust nightly，以及当前平台的 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
pnpm --dir src/celemod-ui install
pnpm --dir src/celemod-ui tauri dev
```

前端检查与桌面端构建：

```bash
pnpm --dir src/celemod-ui typecheck
pnpm --dir src/celemod-ui build
pnpm --dir src/celemod-ui tauri build
```
