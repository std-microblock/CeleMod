import { dirname, resolve } from 'node:path';
import { build, type Plugin } from 'esbuild';
import * as sass from 'sass';

export type SciterDevBundles = {
  app: string;
  css: string;
};

const sourcePlugin = (projectRoot: string, sourceRoot: string): Plugin => ({
  name: 'celemod-source',
  setup(buildApi) {
    const aliases = new Map([
      ['react-dom/test-utils', 'preact/test-utils'],
      ['react/jsx-runtime', 'preact/jsx-runtime'],
      ['react-dom', 'preact/compat'],
      ['react', 'preact/compat'],
      ['path', 'path-browserify'],
    ]);

    buildApi.onResolve(
      { filter: /^(react-dom\/test-utils|react\/jsx-runtime|react-dom|react|path)$/ },
      ({ path, kind }) => buildApi.resolve(aliases.get(path)!, {
        resolveDir: projectRoot,
        kind,
      })
    );
    buildApi.onResolve({ filter: /^src\// }, ({ path, kind }) =>
      buildApi.resolve(`./${path.slice(4)}`, { resolveDir: sourceRoot, kind })
    );
    buildApi.onResolve({ filter: /^locales\// }, ({ path, kind }) =>
      buildApi.resolve(`./${path}`, { resolveDir: projectRoot, kind })
    );
    buildApi.onResolve({ filter: /^stock:/ }, ({ path }) => ({
      path,
      external: true,
    }));
    buildApi.onLoad({ filter: /\.scss$/ }, ({ path }) => ({
      contents: sass.compile(path, { style: 'expanded' }).css,
      loader: 'css',
      resolveDir: dirname(path),
    }));
  },
});

const outputText = (
  outputs: Awaited<ReturnType<typeof build>>['outputFiles'],
  extension: string
) => outputs?.find(({ path }) => path.endsWith(extension))?.text ?? '';

export const buildSciterDevBundles = async (
  projectRoot: string,
  sourceRoot: string
): Promise<SciterDevBundles> => {
  const result = await build({
    entryPoints: [resolve(sourceRoot, 'index.tsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    write: false,
    outdir: 'out',
    entryNames: 'app',
    tsconfig: resolve(projectRoot, 'tsconfig.json'),
    loader: {
      '.png': 'dataurl',
      '.webp': 'dataurl',
    },
    plugins: [sourcePlugin(projectRoot, sourceRoot)],
  });

  return {
    app: outputText(result.outputFiles, '.js'),
    css: outputText(result.outputFiles, '.css'),
  };
};
