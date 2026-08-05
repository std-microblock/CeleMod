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
