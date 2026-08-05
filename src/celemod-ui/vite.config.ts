import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  buildSciterDevBundles,
  type SciterDevBundles,
} from './scripts/sciter-dev-bundler';

const projectRoot = __dirname;
const sourceRoot = resolve(projectRoot, 'src');
const localeRoot = resolve(projectRoot, 'locales');
const sciterPlugin = (): Plugin => {
  let hmrServer: WebSocketServer | undefined;
  let bundles: SciterDevBundles | undefined;
  let version = Date.now();
  let rebuildDevBundles: (() => Promise<void>) | undefined;

  const broadcast = (payload: unknown) => {
    const message = JSON.stringify(payload);
    for (const client of hmrServer?.clients ?? []) {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    }
  };

  return {
    name: 'celemod-sciter-runtime',
    enforce: 'post',
    async configureServer(server) {
      const rebuild = async () => {
        bundles = await buildSciterDevBundles(projectRoot, sourceRoot);
        version = Date.now();
      };
      rebuildDevBundles = rebuild;

      await rebuild();

      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?', 1)[0];
        const content = path === '/__celemod_runtime.js'
          ? bundles?.runtime
          : path === '/__celemod_app.js'
            ? bundles?.app
            : path === '/__celemod_app.css'
              ? bundles?.css
              : undefined;
        if (content === undefined) return next();

        response.statusCode = 200;
        response.setHeader(
          'Content-Type',
          path?.endsWith('.css') ? 'text/css' : 'application/javascript'
        );
        response.setHeader('Cache-Control', 'no-store');
        response.end(content);
      });

      hmrServer = new WebSocketServer({ noServer: true });
      const upgrade = (request: any, socket: any, head: Buffer) => {
        if (request.url !== '/__celemod_hmr') return;
        hmrServer?.handleUpgrade(request, socket, head, (client) => {
          hmrServer?.emit('connection', client, request);
          client.send(JSON.stringify({ type: 'connected', version }));
        });
      };
      server.httpServer?.on('upgrade', upgrade);
      server.httpServer?.once('close', () => {
        server.httpServer?.off('upgrade', upgrade);
        for (const client of hmrServer?.clients ?? []) client.terminate();
        hmrServer?.close();
      });
    },
    async handleHotUpdate(context) {
      const isAppSource = context.file.startsWith(sourceRoot) ||
        context.file.startsWith(localeRoot);
      if (!isAppSource || !rebuildDevBundles) return;
      try {
        await rebuildDevBundles();
        broadcast({
          type: 'update',
          version,
          cssOnly: /\.(css|scss)$/.test(context.file),
        });
      } catch (error) {
        const message = error instanceof Error ? error.stack : String(error);
        context.server.config.logger.error(message ?? String(error));
        broadcast({ type: 'error', message });
      }
      return [];
    },
    transformIndexHtml(html, context) {
      const withoutBrowserClient = html.replace(
        /\s*<script type="module" src="\/@vite\/client"><\/script>\s*/,
        '\n'
      );
      const withRuntime = withoutBrowserClient.replace(
        '<script>/* @sciter-runtime */</script>',
        context.bundle
          ? `<script type="module">${readFileSync(
              resolve(sourceRoot, 'platform/sciter-runtime.js'),
              'utf8'
            )}</script>`
          : `<script type="module">${readFileSync(
              resolve(sourceRoot, 'platform/sciter-vite-bootstrap.js'),
              'utf8'
            )}</script>`
      );

      return context.bundle
        ? withRuntime.replace(
            './src/resources/Celemod.png',
            './Celemod.png'
          )
        : withRuntime.replace(
            /\s*<script type="module" src="\/src\/index\.tsx(?:\?[^\"]*)?"><\/script>\s*/,
            '\n'
          );
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'Celemod.png',
        source: readFileSync(resolve(sourceRoot, 'resources/Celemod.png')),
      });
    },
  };
};

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
    host: 'localhost',
    port: 1234,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 8192,
    modulePreload: false,
    sourcemap: false,
    target: 'es2018',
  },
});
