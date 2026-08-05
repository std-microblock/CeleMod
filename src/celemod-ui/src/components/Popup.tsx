import { type ComponentType, createContext, createElement } from 'react';
import { createRoot } from 'react-dom/client';

export const PopupContext = createContext<{ hide(): void }>({ hide() {} });

export const createPopup = (
  Content: ComponentType,
  { cancelable = true, backgroundMask = 'rgba(0, 0, 0, 0.5)' } = {},
) => {
  const container = document.createElement('div');
  container.className = 'popup-container';
  container.style.background = backgroundMask;
  document.body.appendChild(container);
  const root = createRoot(container);

  const controls = {
    show() {
      container.style.opacity = '1';
      container.style.transform = 'scale(1)';
    },
    hide() {
      container.style.opacity = '0';
      container.style.transform = 'scale(1.3)';
      setTimeout(() => {
        root.unmount();
        container.remove();
      }, 200);
    },
  };

  container.addEventListener('click', (event) => {
    if (cancelable && event.target === container) controls.hide();
  });
  requestAnimationFrame(controls.show);
  root.render(
    <PopupContext.Provider value={controls}>
      {createElement(Content)}
    </PopupContext.Provider>,
  );
  return controls;
};
