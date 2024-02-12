import { useState } from "preact/hooks";
import { useEffect } from "react";

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const callRemote = (name: string, ...args: any[]) => {
    // @ts-ignore
    return Window.this.xcall(name, ...args)
}

export const useSysModule: (n: string) => any | null = (name: string) => {
    console.log(env)
    const [module, setModule] = useState(null);
    useEffect(() => {
        // @ts-ignore
        if (window[name]) setModule(window[name]);
        else {
            // @ts-ignore
            if (!window[name + '_promise'])
                eval(`
        window.${name}_promise = (async()=>{
            await import('@${name}').then(v => {
                window.${name} = v;
                return v;
            });
        })();
    `)
            // @ts-ignore
            window[name + '_promise'].then(() => {
                console.log('loaded', name)
                //@ts-ignore
                setModule(window[name]);
            });
        }
    }, []);

    return module;
}

export const useBlockingMask = () => {
    const [maskEnabled, setMaskEnabled] = useState(false);
    const [maskText, setMaskText] = useState("");

    let element = document.querySelector(".blocking-mask") as HTMLElement;
    if (!element) {
        element = document.createElement("div");
        element.className = "blocking-mask";
        document.body.appendChild(element);
    }

    useEffect(() => {
        if (maskEnabled) {
            element.style.display = "block";
            element.style.opacity = "1";
            element.innerText = maskText;
        } else {
            element.style.opacity = "0";
            setTimeout(() => {
                element.style.display = "none";
            }, 200);
        }
    }, [maskEnabled, maskText])

    return {
        setMaskEnabled,
        setMaskText
    }
}

export class EventTarget {
    listeners: { [key: string]: Function[] } = {};
    addEventListener(name: string, cb: Function) {
        if (!this.listeners[name]) this.listeners[name] = [];
        this.listeners[name].push(cb);
    }
    on(name: string, cb: Function) {
        this.addEventListener(name, cb);
    }
    removeEventListener(name: string, cb: Function) {
        if (!this.listeners[name]) return;
        this.listeners[name] = this.listeners[name].filter(v => v !== cb);
    }
    remove(name: string, cb: Function) {
        this.removeEventListener(name, cb);
    }
    dispatchEvent(name: string, ...args: any[]) {
        if (!this.listeners[name]) return;
        this.listeners[name].forEach(cb => cb(...args));
    }
}

// polyfill for URLSearchParams
export class URLSearchParams {
    private params: Map<string, string> = new Map()
    constructor(init?: string | { [key: string]: string | string[] }) {
        if (typeof init === 'string') {
            init.split('&').forEach(v => {
                const [k, v_] = v.split('=')
                this.params.set(k, v_)
            })
        } else if (init) {
            Object.entries(init).forEach(([k, v]) => {
                this.params.set(k, v.toString())
            })
        }
    }
    set(key: string, value: string) {
        this.params.set(key, value)
    }
    toString() {
        return [...this.params.entries()].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    }
}

export const celemodVersion = callRemote('celemod_version');
export const celemodHash = callRemote('celemod_hash');
export const celemodUA = `CeleMod/${celemodVersion}-${celemodHash.substr(0, 6)}`;

export const displayDate = (date_: string | Date) => {
    const date = new Date(date_);
    const pad = (v: number) => v.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// if a > b, return 1 else -1, 0 if equal
export const compareVersion = (a: string, b: string) => {
    // any part of the version is greater
    const aParts = a.split(".");
    const bParts = b.split(".");
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aPart = aParts[i] || "0";
        const bPart = bParts[i] || "0";
        if (aPart === bPart) {
            continue;
        }
        return parseInt(aPart) > parseInt(bPart) ? 1 : -1;
    }
    return 0;
}

export const selectGamePath = (successCallback) => {
    // @ts-ignore
    const res = Window.this.selectFile({
        mode: 'open',
        filter: 'Celeste.exe|Celeste.exe',
    });
    if (res !== null) {
        // strip file:// and Celeste.exe
        const before = 'file://'.length;
        const after = 'celeste.exe'.length;
        const decoded = decodeURI(res)
        const path = decoded.slice(before, decoded.length - after);
        console.log('Selected', path);
        successCallback(path);
        return path
    }
};
