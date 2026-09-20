# Crash assistant regression fixture

From `src/celemod-ui`, run `node tests/crash-assistant/serve.mjs` and open
`http://127.0.0.1:1429/tests/crash-assistant/`. This server is local-only and
substitutes native IPC, network and game files with fixed data.

The fixture renders the real `CrashAssistant` component, its popup container,
global stylesheet and the captured excerpt of a real EverestUltra crash report.
It exists because the popup is a blocking, non-cancelable overlay: if the
container or its content ends up transformed, or the footer scrolls out of the
window, the user cannot dismiss it or reach any action.

Check with `node tests/crash-assistant/shoot.mjs <outDir> [width] [height]`
(repeat at 1100x900, 800x600 and 1920x1080). It fails when the heading, close
button, columns or the `忽略` action fall outside the viewport, or when the
popup container keeps a residual scale transform.
