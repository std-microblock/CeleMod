# CeleMod UI

The Sciter-based frontend for CeleMod.

## Development

```bash
pnpm install
pnpm dev
```

Run the Rust application in debug mode after the Vite server starts. The debug
loader connects to `http://127.0.0.1:5173`.

## Build

```bash
pnpm build
```

Vite writes the web assets to `dist/`. The post-build script then applies the
small Sciter compatibility transforms, creates `index_windows.html`, and packs
the directory into `../../resources/dist.rc`.

Use `pnpm build:web` when only the unpacked Vite output is needed.
