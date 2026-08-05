import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const projectRoot = __dirname;
const sourceRoot = resolve(projectRoot, 'src');
const sciterRuntime = readFileSync(
  resolve(sourceRoot, 'platform/sciter-runtime.js'),
  'utf8'
);

const sciterPlugin = (): Plugin => ({
  name: 'celemod-sciter-runtime',
  enforce: 'post',
  transformIndexHtml(html, context) {
    const withRuntime = html.replace(
      '<script>/* @sciter-runtime */</script>',
      `<script type="module">${sciterRuntime}</script>`
    );

    return context.bundle
      ? withRuntime.replace(
          './src/resources/Celemod.png',
          './Celemod.png'
        )
      : withRuntime;
  },
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'Celemod.png',
      source: readFileSync(resolve(sourceRoot, 'resources/Celemod.png')),
    });
  },
});

export default defineConfig({
  base: './',
  plugins: [sciterPlugin()],
  resolve: {
    alias: [
      { find: 'react-dom/test-utils', replacement: 'preact/test-utils' },
      { find: 'react/jsx-runtime', replacement: 'preact/jsx-runtime' },
      { find: 'react-dom', replacement: 'preact/compat' },
      { find: 'react', replacement: 'preact/compat' },
      { find: 'path', replacement: 'path-browserify' },
      { find: 'locales', replacement: resolve(projectRoot, 'locales') },
      { find: 'src', replacement: sourceRoot },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2018',
  },
});
