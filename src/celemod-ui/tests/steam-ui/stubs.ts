import { useState } from "react";
import { create } from "zustand";
export const useAppStore = create<any>(set => ({ theme: "vanilla", setTheme: (theme: string) => set({ theme }) }));
export const useEnableAcrylic = () => ({ enableAcrylic: false, setEnableAcrylic() {} });
export const useGamePath = () => useState("");
export const useGlobalContext = () => ({ pageController: { setPage() {} } });
export const invokeCommand = async () => {};
