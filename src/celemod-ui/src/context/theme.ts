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

export const useThemeContext = () => {
    const { storage, save } = useStorage();
    const {
        enableAcrylic,
        setEnableAcrylic
    } = useEnableAcrylic();

    useEffect(() => {
        storage.root ??= {};
        storage.root.enableAcrylic ??= true;

        setEnableAcrylic(storage.root.enableAcrylic);
    }, [storage]);

    useEffect(() => {
        // @ts-ignore
        Window.this.blurBehind = enableAcrylic ? 'dark ultra source-desktop' : 'none'
        storage.root.enableAcrylic = enableAcrylic;
        save();
    }, [enableAcrylic]);

    return {
        enableAcrylic,
        setEnableAcrylic
    }
}