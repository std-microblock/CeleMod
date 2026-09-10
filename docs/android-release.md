# Android APK CI / 发布

`.github/workflows/Build.yml` 的 `android` job 使用 Windows runner，安装 Java 21、
.NET 8、Android SDK 36、NDK 28.2.13676358 和 Rust ARM64 target。
它会下载并校验锁定的 RAL 运行库源码/APK，构建 managed hooks、cimgui、Steam worker、
前端、Rust 和 Kotlin，不打包 Celeste 游戏资源。

## 下载与发布

- `master` push、PR、分支上的手动运行：上传 `CeleMod-android-arm64` Actions artifact，
  内含 `CeleMod_<版本>_android-arm64-debug.apk` 和 SHA-256 校验文件。
- `master` 每次 push（也支持在 `master` 手动运行）：所有平台构建和测试成功后，更新固定的
  `nightly` 标签和 **CeleMod Nightly** 预发布，包含 Windows EXE、macOS DMG、Linux
  AppImage/DEB、Android Debug APK 和 APK 校验文件。替换旧附件，不累积历史 nightly，
  不修改正式版本标签，也不将 nightly 设为 Latest。
- nightly 发布串行执行，发布前核对 `master` HEAD，过期构建不会覆盖新提交。
  上传期间 release 为草稿，全部上传成功后才公开；上传失败可重新运行工作流恢复发布。
  PR 不发布 nightly。每次 push 都构建；连续提交时仅当前 `master` HEAD 发布。
- 推送 `v<版本>` 标签（或在该标签上手动运行）：构建优化后的 Release APK，签名并校验后，
  将 `CeleMod_<版本>_android-arm64.apk` 和校验文件上传到同名 GitHub Release，
  同时保留 Actions artifact。
- 目前只提供 ARM64，最低 Android 9 / API 28。Debug 包不是正式发行包；不同签名不能覆盖安装。

## 首次配置签名

在仓库 **Settings → Secrets and variables → Actions** 配置：

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 正式签名 keystore 文件的 Base64 编码 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_ALIAS` | 签名密钥别名 |
| `ANDROID_KEY_PASSWORD` | 签名密钥密码（与 keystore 密码相同也要设置） |

使用并备份长期有效的正式签名密钥；已经发行过 APK 时，必须沿用原密钥才能覆盖升级。
不要把 keystore、密码或 Base64 内容提交到 Git。CI 只在签名步骤临时还原 keystore，
密码通过环境变量传给 `apksigner`，结束后删除临时文件。
标签构建缺少任何签名 secret 都会失败，不会回退到调试签名或发布未签名 APK。
普通分支/PR 构建不需要 secrets。
Nightly 使用 CI 的调试签名，不使用正式签名 secrets；不同 runner 生成的调试密钥可能不同，
覆盖安装失败时需先备份数据再卸载旧包，不能视为正式包的无缝升级通道。

发布前，将 `version.txt`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml` 中的版本同步。
标签必须是 `v` 加 `version.txt` 中的版本，例如 `v1.1.11`。
Android `versionCode` 使用 `major * 1000000 + minor * 1000 + patch`，升级时必须递增。

所有 Android 工程和依赖准备脚本也必须提交，包括 `src-tauri/gen/android` 下的 Gradle wrapper、
buildSrc、应用源码/资源，以及 `android/runtime` 下的锁定配置和源码。
忽略的运行库、JNI 输出和 Tauri 自动生成文件由 CI 重新生成，不应提交。

CI 会先用 `cargo tree --locked` 检查依赖，并运行 managed hooks 和 Kotlin 单元测试。
提交 `Cargo.lock` 时不要启用本机 Cargo 配置中的路径 `[patch]`：例如把 Git 依赖
`game-scanner` 替换为 `.local` 源码会使锁文件丢失 Git source，本机能编译，干净 CI 却会
因 `--locked` 失败。应在无本地 patch 的环境解析依赖并验证锁文件，不能移除 `--locked` 绕过。

## 本地构建

在配置好同版本 Android 工具链的 Windows PowerShell 中：

```powershell
pnpm --dir src/celemod-ui install --frozen-lockfile
./scripts/prepare-android-runtime.ps1
./scripts/build-android.ps1          # Debug，调试签名
./scripts/build-android.ps1 -Release # Release，尚未签名
```

本地 Release 输出：
`src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release-unsigned.apk`。
发布流程依次执行 `zipalign`、`apksigner sign`、签名验证和对齐验证，最后生成 SHA-256。
