import { Component, FunctionalComponent, createContext, h, render } from "preact";

export const PopupContext = createContext<{
    hide(): void
}>({} as any);

export const createPopup = (fc: FunctionalComponent, {
    cancelable = true,
    backgroundMask = "rgba(0, 0, 0, 0.5)"
} = {}) => {
    const container = document.createElement("div");
    container.className = "popup-container";
    container.style.background = backgroundMask;
    document.body.appendChild(container);

    const ctx = {
        show() {
            container.style.opacity = "1";
            container.style.transform = "scale(1)";
        },
        hide() {
            container.style.opacity = "0";
            container.style.transform = "scale(1.3)";
            setTimeout(() => {
                render(null, container);
                setTimeout(() => {
                    container.remove();
                }, 10)
            }, 200);
        }
    }

    container.addEventListener("click", e => {
        if (cancelable && e.target === container) {
            ctx.hide();
        }
    })

    setTimeout(() => {
        ctx.show();
    })

    const ele = <PopupContext.Provider value={ctx}>
        {h(fc, {})}
    </PopupContext.Provider>

    render(ele, container);
    return container;
}