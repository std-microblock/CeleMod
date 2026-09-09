# Android log viewer regression fixture

Run `node tests/android-logs/serve.mjs` from the UI package. Open
`http://127.0.0.1:1428/tests/android-logs/` with the in-app browser.
The fixture uses the real component and styles, but substitutes native IPC.
No device logs, account data or network services are accessed.

Check at 393×852, 320×568 and landscape 852×393:

- Open **查看日志**: loading state, then a wrapped long game log scrolled to its end.
- Log text containing `<script>` remains text, not executable markup.
- **复制日志** reports success; **刷新** increases the number at the log tail.
- **Everest 安装** shows **暂无日志** and disables copy/bottom buttons.
- **CeleMod 应用** shows a readable error and still permits refresh or source switching.
- Quickly switch game → installer; the delayed game response must not replace the installer state.
- Close using the close button or Escape, then reopen. In-flight responses must not revive a closed view.
- Controls and footer remain within the viewport; only the log body scrolls.
- On a device build, Android Back must close this dialog rather than exit CeleMod.

The production backend accepts only `game`, `installer`, and `app` source IDs.
It reads at most the last 256 KiB and never reads Steam IPC or credentials.
Read-path tests are in `src-tauri/src/log_viewer.rs` (workspace-relative):
`cargo test -p cele-mod --lib log_viewer::tests`.
