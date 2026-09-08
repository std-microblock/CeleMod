# Android Steam 接入（需真实账号验收）

## 使用

1. Android 主页或设置页的 **Steam · Celeste** 登录。支持手机确认、手机验证码、邮件验证码；需要验证码时勾选“优先使用验证码”。密码不保存。
2. 点击“从 Steam 下载游戏”。Steam 必须授予当前账号 Celeste 的 depot key 和 manifest request code；不支持匿名下载付费游戏。默认从 **Steam 实时产品信息**选择 public 分支的 Linux/FNA depot，不依赖第三方资源中转或写死 manifest。
3. 资源安装到应用外部专属存储的 `games/Steam-<SteamID64>`。点击“选择已下载游戏并安装 Everest”，安装现有 Android 兼容 Everest 后启动。不会覆盖已有 ZIP 导入目录、现有 Everest 或 Mods。
4. 自动云同步默认开启。启动前同步失败或冲突会阻止启动；需要离线时由用户明确开启“离线游玩”。游戏进程结束后自动同步，不以 Activity 暂停代替游戏退出。
5. 冲突时明确选择手机版或云端版；两边旧版本先备份。退出账号只删除本地登录令牌，游戏、备份和未同步存档保留。令牌过期后重新登录原账号。

“检查 Steam 连接”只进行匿名连接和 Celeste 产品信息读取，不需要密码，不读取/修改云存档。

## 数据安全与恢复

- SteamKit2 在现有 CoreCLR 中运行；Tauri/Kotlin 只传递命令、状态和结果。没有 localhost 网络服务、第三方登录网页或开发者 Web API key。
- 密码只用于当前请求；账号、refresh token、Steam 设备 client ID 使用 Android Keystore AES-GCM 加密保存。WebView 不会收到 token。IPC 在应用私有目录，消费后删除，冷启动清理遗留请求/结果。Android 备份在 manifest 中禁用。
- SteamKit 协议日志只在**匿名连接检查**期间开启，写入私有 `steam-ipc/probe.log`；账号登录、资源下载和云同步不启用协议日志。
- 资源逐块下载/解密、整文件 SHA-1 + 大小校验；取消或失败不发布半成品。成功文件可在同一 manifest 的下次重试复用，最终以同文件系统目录 rename 发布；私有安装回执恢复发布后、绑定前的崩溃。不进行原地 depot 修复，以免破坏 Everest。
- 云规则从 Steam PICS 验证为 `GameInstall/Saves/*.celeste`。按照相同规则同步，包含 `.celeste` 格式的模组存档；不上传 Mods ZIP、任意文件、Steam 凭据或模组独立的非 `.celeste` 数据。规则变化时停止，不猜测映射。
- 使用基线/本地/云端 SHA-1 三方比较，**不以修改时间判胜负**。只有基线证明另一端未变时才自动覆盖或删除。两端修改、删除对修改、首次双方已有不同存档都触发冲突。
- 写入前预下载远端快照、备份本地快照并重新检查两端是否变化。选择冲突版本时，必须与用户看到的冲突快照仍一致，否则重新确认。备份放在应用私有 `steam-cloud/<SteamID>/<游戏路径SHA256>/backups/`，不是 Steam 自动同步的 Saves 目录；目前不自动清理这些备份。
- 云端上传使用 BeginAppUploadBatch、分块 HTTPS 请求、ClientCommitFileUpload 和 **阻塞批次确认**；包括配额检查、删除提交、PC 单文件 ZIP 解压、大小和 SHA-1 校验。失败不更新基线；有持久 pending 标记，应用恢复前台/网络恢复时重试。冲突不会后台自动选版本。
- 启动前发送 Steam 云启动意图，其他设备有未完成操作时阻止在线启动；退出同步成功后发送结束通知。强制结束应用/系统杀进程不能保证即时上传，下一次运行恢复；明确离线或关闭自动云同步时不会擅自上传。
- 不允许在前一账号/游戏仍有 pending 存档时开始另一个 Steam 目录，避免把同一存档混入其他账号。ZIP 导入仍保持本地行为，不会擅自关联 Steam。
- 活跃操作使用 Android dataSync 前台服务和有超时的唤醒锁；同步、下载、安装和游戏写入互斥。

## DRM / 平台边界

下载权限由真实 Steam 服务校验；这不是 Steam 客户端、Steam 登录会话伪造器或 DRM 解包器。
下载后检查 Celeste.exe 是纯托管 IL 且有 FNA/Content；原生包装器、非托管 SteamStub 或不兼容 depot 会停止，不移除 DRM。
Android 通过已存在的 Everest/CoreCLR 路径运行，不执行 depot 内的桌面 x86/x64 启动器或原生库。

**尚未实现桌面 Steamworks 原生 ABI、Steam Overlay、成就接口和 SteamStub 模拟。**
如果某个 Steam 构建在运行时强依赖桌面 Steamworks/DRM，仍需要单独适配，不能宣称本次已解决。
纯 IL 检查不等价于证明所有运行时 DRM/Steamworks 行为兼容；必须用拥有游戏的真实账号下载并启动验收。
云存档遵循同一保存文件规则和同步时机，但未经真实双端账号往返测试，不能宣称已完全等同官方 PC Steam 体验。

## 构建与验证

```powershell
.local/dotnet-sdk/dotnet.exe run --project android/steam-tests
.local/dotnet-sdk/dotnet.exe build android/steam/CeleMod.Steam.csproj
pnpm --dir src/celemod-ui typecheck
scripts/build-android.ps1
```

依赖版本/哈希：`android/steam/packages.lock.json`；构建脚本使用 `--locked-mode`，不做裁剪或单文件合并。许可证随独立 managed assemblies 一起装入 APK。Release R8 必须保留 `net.dot.android.crypto`，这些类由 .NET TLS JNI 按名字加载。

已验证：101 项离线同步/路径/哈希/解压安全断言、C# 构建、TypeScript 检查、Android APK 构建；桌面运行同一 Steam worker 匿名连接并成功获取 Celeste PICS 产品信息。
手机验证已确认 Tauri → Kotlin → CoreCLR → SteamKit IPC 链路、重复执行和错误回传；未登录下载被拒绝、无请求时验证码被拒绝、重复操作被拒绝、结束后没有遗留 request/result/guard 文件，界面无横向溢出。实测手机的系统 DNS 同样无法解析 example.com / api.steampowered.com，网络连接检查因此失败（不是成功登录）；没有使用真实 Steam 凭据或写入用户云端存档。

发布前必须在联网手机和拥有 Celeste 的测试账号上完成：

- 密码错误、三种 Steam Guard、令牌持久登录/过期/退出账号；无授权账号下载被拒绝。
- 完整 depot 下载，取消后续传、空间不足、下载后崩溃恢复，以及实际 Steam 版 Everest 启动/DRM 兼容。
- PC → 手机首次拉取、手机存档 → PC、改动/删除同步、两端冲突及两种解决方向、选择后云端再次变化。
- 断网退出、联网重试、系统杀进程恢复、云配额不足、批次上传部分失败、跨账号隔离；先备份测试账号的云存档。

协议实现参考（不依赖这些站点作为资源服务器）：
- SteamKit2 3.4.0： https://github.com/SteamRE/SteamKit/tree/1c7bc9c41a529e8fbb1e6890f1e4dbcdc5200cb7
- SteamKit `SteamMsgCloud.cs`、Authentication、CDN APIs。
- DepotDownloader 的授权 CDN 调用方式： https://github.com/SteamRE/DepotDownloader
- Steam Auto-Cloud： https://partner.steamgames.com/doc/features/cloud
