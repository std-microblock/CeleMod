import { dirname, resolve } from 'node:path';
import { build, type Plugin } from 'esbuild';
import * as sass from 'sass';

export type SciterDevBundles = {
  app: string;
  css: string;
  runtime: string;
};

// App updates share one Preact instance so the stable root in the bootstrap can
// retain hook state while a newly evaluated app module replaces its body.
const facadeFor = (path: string) => {
  if (path.endsWith('/hooks')) {
    return `
      const api = globalThis.__celemodPreactRuntime.hooks;
      export const useCallback = api.useCallback;
      export const useContext = api.useContext;
      export const useDebugValue = api.useDebugValue;
      export const useEffect = api.useEffect;
      export const useErrorBoundary = api.useErrorBoundary;
      export const useId = api.useId;
      export const useImperativeHandle = api.useImperativeHandle;
      export const useLayoutEffect = api.useLayoutEffect;
      export const useMemo = api.useMemo;
      export const useReducer = api.useReducer;
      export const useRef = api.useRef;
      export const useState = api.useState;
    `;
  }

  if (path.endsWith('/jsx-runtime')) {
    return `
      const api = globalThis.__celemodPreactRuntime.jsxRuntime;
      export const Fragment = api.Fragment;
      export const jsx = api.jsx;
      export const jsxs = api.jsxs;
      export const jsxDEV = api.jsxDEV;
    `;
  }

  const namespace = path.includes('compat') || path.startsWith('react')
    ? 'compat'
    : 'preact';

  return `
    const api = globalThis.__celemodPreactRuntime.${namespace};
    export default api;
    export const Children = api.Children;
    export const Component = api.Component;
    export const Fragment = api.Fragment;
    export const PureComponent = api.PureComponent;
    export const StrictMode = api.StrictMode;
    export const Suspense = api.Suspense;
    export const SuspenseList = api.SuspenseList;
    export const cloneElement = api.cloneElement;
    export const createContext = api.createContext;
    export const createElement = api.createElement || api.h;
    export const createFactory = api.createFactory;
    export const createPortal = api.createPortal;
    export const createRef = api.createRef;
    export const forwardRef = api.forwardRef;
    export const h = api.h || api.createElement;
    export const hydrate = api.hydrate;
    export const isValidElement = api.isValidElement;
    export const lazy = api.lazy;
    export const memo = api.memo;
    export const options = api.options;
    export const render = api.render;
    export const startTransition = api.startTransition;
    export const unmountComponentAtNode = api.unmountComponentAtNode;
    export const useCallback = api.useCallback;
    export const useContext = api.useContext;
    export const useDebugValue = api.useDebugValue;
    export const useEffect = api.useEffect;
    export const useErrorBoundary = api.useErrorBoundary;
    export const useId = api.useId;
    export const useImperativeHandle = api.useImperativeHandle;
    export const useLayoutEffect = api.useLayoutEffect;
    export const useMemo = api.useMemo;
    export const useReducer = api.useReducer;
    export const useRef = api.useRef;
    export const useState = api.useState;
    export const useSyncExternalStore = api.useSyncExternalStore;
  `;
};

const sharedRuntimePlugin = (): Plugin => ({
  name: 'celemod-shared-preact-runtime',
  setup(buildApi) {
    buildApi.onResolve(
      {
        filter: /^(preact(?:\/(?:hooks|compat|jsx-runtime))?|react(?:-dom)?(?:\/jsx-runtime)?)$/,
      },
      ({ path }) => ({ path, namespace: 'celemod-preact' })
    );
    buildApi.onLoad(
      { filter: /.*/, namespace: 'celemod-preact' },
      ({ path }) => ({ contents: facadeFor(path), loader: 'js' })
    );
  },
});

const sourcePlugin = (projectRoot: string, sourceRoot: string): Plugin => ({
  name: 'celemod-source',
  setup(buildApi) {
    buildApi.onResolve({ filter: /^celemod:app$/ }, () => ({
      path: 'app',
      namespace: 'celemod-entry',
    }));
    buildApi.onLoad(
      { filter: /.*/, namespace: 'celemod-entry' },
      () => ({
        contents: `
          import './index.scss';
          import './i2.css';
          export { default } from './App';
        `,
        loader: 'tsx',
        resolveDir: sourceRoot,
      })
    );
    buildApi.onResolve({ filter: /^src\// }, ({ path, kind }) =>
      buildApi.resolve(`./${path.slice(4)}`, { resolveDir: sourceRoot, kind })
    );
    buildApi.onResolve({ filter: /^locales\// }, ({ path, kind }) =>
      buildApi.resolve(`./${path}`, { resolveDir: projectRoot, kind })
    );
    buildApi.onResolve({ filter: /^path$/ }, ({ kind }) =>
      buildApi.resolve('path-browserify', { resolveDir: projectRoot, kind })
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
  const runtimeBuild = await build({
    stdin: {
      contents: `
        import * as preact from 'preact';
        import * as hooks from 'preact/hooks';
        import * as compat from 'preact/compat';
        import * as jsxRuntime from 'preact/jsx-runtime';

        globalThis.__celemodPreactRuntime = {
          preact,
          hooks,
          compat,
          jsxRuntime,
        };

        export const h = preact.h;
        export const render = preact.render;
      `,
      loader: 'js',
      resolveDir: projectRoot,
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    write: false,
  });

  const appBuild = await build({
    entryPoints: ['celemod:app'],
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
    plugins: [
      sharedRuntimePlugin(),
      sourcePlugin(projectRoot, sourceRoot),
    ],
  });

  return {
    runtime: runtimeBuild.outputFiles?.[0]?.text ?? '',
    app: outputText(appBuild.outputFiles, '.js'),
    css: outputText(appBuild.outputFiles, '.css'),
  };
};
