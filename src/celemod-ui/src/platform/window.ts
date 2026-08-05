const sciterWindow = (Window as any).this;
const versionElement = document.querySelector<HTMLElement>('.celemod-version');

if (versionElement) {
  versionElement.onclick = () => {
    if (!document.querySelector('.popup-container')) window._checkUpdate();
  };
  (versionElement as any).on('contextmenu', () =>
    sciterWindow.xcall('show_log_window')
  );
}

const captionVersion = document.querySelector<HTMLElement>('.caption-version');
const captionHash = document.querySelector<HTMLElement>('.caption-hash');
if (captionVersion) {
  captionVersion.innerText = sciterWindow.xcall('celemod_version');
}
if (captionHash) {
  captionHash.innerText = sciterWindow.xcall('celemod_hash').slice(0, 6);
}

const [x, y, width, height] = sciterWindow.box('xywh', 'border', 'desktop');
if (width < 800 || height < 600) {
  sciterWindow.move(x, y, 800 * (800 / width), 600 * (600 / height));
}

if (env.PLATFORM !== 'Windows') {
  const windowControls = document.querySelector<HTMLElement>('.win-ctrl');
  if (windowControls) windowControls.style.display = 'none';
} else {
  document.documentElement.setAttribute('window-frame', 'solid');
}
document.documentElement.setAttribute('platform', env.PLATFORM);

sciterWindow.isResizable = true;
window.isMaximizable = true;

const updateStyles = async () => {
  for (const style of Array.from(document.querySelectorAll('style'))) {
    const url = style.getAttribute('src');
    if (!url) continue;
    const text = await fetch(url).then((response) => response.text());
    if (text === style.textContent) continue;
    (style as any).state.disabled = true;
    style.textContent = text;
    (style as any).state.disabled = false;
  }
};

console.clear = () => {
  console.log('------- Cleared --------');
  updateStyles();
};

(location as any).reload = () => {
  setTimeout(() => sciterWindow.load(location.href));
};

(document as any).on('keyup', (event: KeyboardEvent) => {
  if (event.code === 'F5') location.reload();
});
