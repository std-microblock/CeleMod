# CeleMod UI

The React frontend for the CeleMod Tauri 2 desktop application. Application state is managed with Zustand and Immer.

## Development

```bash
pnpm install
pnpm dev
```

Start the complete desktop application from this directory:

```bash
pnpm tauri dev
```

Vite runs on `http://localhost:1420` and provides normal React hot module replacement.

## Build

```bash
pnpm build
```

Vite writes the web assets to `dist/`. To create a native installer or bundle:

```bash
pnpm tauri build
```

## Translation

`pnpm translate` uses the DeepSeek Chat Completions API to fill untranslated locale entries. Set the API key before running it:

```powershell
$env:DEEPSEEK_API_KEY = "your-api-key"
pnpm translate
```

```bash
DEEPSEEK_API_KEY=your-api-key pnpm translate
```

The translator sends the source file, line and column, enclosing function or component, usage type, and a short source-code snippet for every matching UI string. This gives DeepSeek the text's actual UI context instead of translating isolated words. Existing non-Chinese translations are kept by `di18n`.

Optional environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | DeepSeek model ID |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API base URL, useful for a compatible proxy |
| `DEEPSEEK_CONCURRENCY` | `3` | Maximum simultaneous API requests |
| `DEEPSEEK_TIMEOUT_MS` | `60000` | Per-request timeout in milliseconds |

The API request uses JSON output and verifies that placeholders such as `{count}`, HTML-like tags, and printf tokens are preserved. Run `pnpm test:i18n` to test context collection and placeholder validation without making an API request.
