import * as env from '@env';
import * as storage from '@storage';
import * as sys from '@sys';

window.env = env;
window.storage = storage;
window.sys = sys;

const endpoint = (path, version = Date.now()) =>
  new URL(`${path}?v=${version}`, location.href).href;

const fetchText = (path, version) =>
  fetch(endpoint(path, version))
    .then((response) => {
      if (response.status >= 400) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response.text();
    })
    .catch((error) => {
      throw new Error(`Failed to fetch ${path}: ${String(error)}`);
    });

const showError = (error) => {
  console.error('[celemod:hmr]', error);
  let overlay = document.querySelector('#celemod-hmr-error');
  if (!overlay) {
    overlay = document.createElement('pre');
    overlay.id = 'celemod-hmr-error';
    overlay.style.cssText =
      'position:fixed;inset:12px;z-index:99999;overflow:auto;padding:16px;' +
      'background:#2b1111;color:#ffd7d7;border:1px solid #d66;';
    document.body.appendChild(overlay);
  }
  overlay.textContent = error?.stack || String(error);
};

const clearError = () => document.querySelector('#celemod-hmr-error')?.remove();

const style = document.createElement('style');
style.id = 'celemod-dev-styles';
document.head.appendChild(style);

let appLoaded = false;
let applying = Promise.resolve();

const applyStyles = async (version) => {
  const css = await fetchText('/__celemod_app.css', version);
  style.state.disabled = true;
  style.textContent = css;
  style.state.disabled = false;
};

const applyInitialApp = async (version) => {
  await applyStyles(version);
  evalModule(await fetchText('/__celemod_app.js', version));
  appLoaded = true;
  console.log('[celemod:dev] loaded app bundle');
};

const queueInitialLoad = (version) => {
  applying = applying
    .then(() => applyInitialApp(version))
    .then(clearError)
    .catch(showError);
};

const queueStyleUpdate = (version) => {
  applying = applying
    .then(() => applyStyles(version))
    .then(() => console.log('[celemod:hmr] applied style update'))
    .then(clearError)
    .catch(showError);
};

const reload = () => setTimeout(() => Window.this.load(location.href));

const connect = () => {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(
    `${protocol}://${location.host}/__celemod_hmr`
  );

  socket.onmessage = ({ data }) => {
    const payload = JSON.parse(String(data));
    if (payload.type === 'connected') {
      if (appLoaded) reload();
      else queueInitialLoad(payload.version);
    } else if (payload.type === 'update') {
      if (payload.cssOnly) queueStyleUpdate(payload.version);
      else reload();
    } else if (payload.type === 'error') {
      showError(payload.message);
    }
  };
  socket.onclose = () => setTimeout(connect, 500);
  socket.onerror = (error) => console.error('[celemod:hmr] websocket', error);
};

connect();
