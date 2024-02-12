import { callRemote } from "../utils";
import { useInstalledMods, useGamePath, useStorage } from "../states";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { EventTarget } from "../utils";
import { create } from "zustand";

export const useEnableAcrylic = create<{
    enableAcrylic: boolean,
    setEnableAcrylic: (v: boolean) => void
}>(set => ({
    enableAcrylic: true,
    setEnableAcrylic: (v) => set({ enableAcrylic: v })
}))

export const createThemeContext = () => {
    const { storage, save } = useStorage();
    const {
        enableAcrylic,
        setEnableAcrylic
    } = useEnableAcrylic();

    useEffect(() => {
        if (!storage) return;
        storage.root ??= {};
        storage.root.enableAcrylic ??= true;
        storage.root.windowSize ??= [800, 600];

        setEnableAcrylic(storage.root.enableAcrylic);
        // @ts-ignore
        const [x, y, w, h] = Window.this.box("xywh", "border", "desktop")
        if (storage.root.windowSize[0] !== w || storage.root.windowSize[1] !== h) {
            console.log('persist size', storage.root.windowSize)
            // @ts-ignore
            Window.this.move(x, y, ...storage.root.windowSize);
        }
    }, [storage]);

    useEffect(() => {
        if (!storage) return;
        // @ts-ignore
        Window.this.blurBehind = enableAcrylic ? 'dark ultra source-desktop' : 'none'
        storage.root.enableAcrylic = enableAcrylic;
        save();
    }, [enableAcrylic, storage]);

    useEffect(() => {
        let lastResize = -1
        const handler = () => {
            const now = Date.now();
            lastResize = now;
            setTimeout(() => {
                if (lastResize === now) {
                    // @ts-ignore
                    const [x, y, w, h] = Window.this.box("xywh", "border", "desktop")
                    console.log('saving window size', w, h)
                    storage.root.windowSize = [w, h];
                    save();
                }
            }, 100);
        }
        // @ts-ignore
        Window.this.on('size', handler)

        return () => {
            // @ts-ignore
            Window.this.off('size', handler)
        }
    }, [storage]);

    return {
        enableAcrylic,
        setEnableAcrylic
    }
}