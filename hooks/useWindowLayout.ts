"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type MouseEvent as ReactMouseEvent,
} from "react";
import { SCALE_CHANGED_EVENT } from "@/lib/scales";

export interface WindowLayout {
    top: number;
    left: number;
    width: number;
    height: number;
}

interface StoredLayout {
    top?: string | number;
    left?: string | number;
    width?: string | number;
    height?: string | number;
}

interface UseWindowLayoutOptions {
    storageKey: string;
    layoutId: string;
    defaultPosition: Pick<WindowLayout, "top" | "left">;
    defaultSize: Pick<WindowLayout, "width" | "height">;
    minSize: Pick<WindowLayout, "width" | "height">;
    resizeSelector?: string;
}

let nextWindowZIndex = 20;

const parsePixels = (value: string | number | undefined, fallback: number) => {
    const parsed =
        typeof value === "number"
            ? value
            : Number.parseFloat(String(value ?? "").replace("px", ""));
    return Number.isFinite(parsed) ? parsed : fallback;
};

const readLayouts = (key: string): Record<string, StoredLayout> => {
    if (typeof window === "undefined") return {};
    try {
        const value = JSON.parse(window.localStorage.getItem(key) ?? "{}");
        return value && typeof value === "object" ? value : {};
    } catch {
        return {};
    }
};

const appScale = () => {
    if (typeof window === "undefined") return 1;
    const value = Number.parseFloat(
        window.getComputedStyle(document.documentElement).getPropertyValue(
            "--app-scale",
        ),
    );
    return Number.isFinite(value) && value > 0 ? value : 1;
};

const clampLayout = (
    layout: WindowLayout,
    options: UseWindowLayoutOptions,
): WindowLayout => {
    if (typeof window === "undefined") return layout;
    const scale = appScale();
    const viewportWidth = window.innerWidth / scale;
    const viewportHeight = window.innerHeight / scale;
    const width = Math.max(options.minSize.width, layout.width);
    const height = Math.max(options.minSize.height, layout.height);

    return {
        width,
        height,
        top: Math.max(
            2,
            Math.min(
                Number.isFinite(layout.top) ? layout.top : 2,
                Math.max(2, viewportHeight - height),
            ),
        ),
        left: Math.max(
            2,
            Math.min(
                Number.isFinite(layout.left) ? layout.left : 2,
                Math.max(2, viewportWidth - width),
            ),
        ),
    };
};

/**
 * Porte de makeDraggable + clampSlotPosition + save/loadWindowLayouts.
 *
 * - Posição/tamanho são salvos em px (mesmo formato do painel original).
 * - O tamanho é limitado pelo viewport já dividido pelo `--app-scale`, porque
 *   `#app-shell` usa `zoom`.
 * - Reclampa ao redimensionar a janela e ao mudar o zoom da interface.
 */
export function useWindowLayout(options: UseWindowLayoutOptions) {
    const {
        defaultPosition,
        defaultSize,
        minSize,
        layoutId,
        resizeSelector,
        storageKey,
    } = options;
    const defaultTop = defaultPosition.top;
    const defaultLeft = defaultPosition.left;
    const defaultWidth = defaultSize.width;
    const defaultHeight = defaultSize.height;
    const minWidth = minSize.width;
    const minHeight = minSize.height;

    const layoutOptions = useMemo<UseWindowLayoutOptions>(
        () => ({
            defaultPosition: { top: defaultTop, left: defaultLeft },
            defaultSize: { width: defaultWidth, height: defaultHeight },
            minSize: { width: minWidth, height: minHeight },
            layoutId,
            resizeSelector,
            storageKey,
        }),
        [
            defaultHeight,
            defaultLeft,
            defaultTop,
            defaultWidth,
            layoutId,
            minHeight,
            minWidth,
            resizeSelector,
            storageKey,
        ],
    );
    const optionsRef = useRef(layoutOptions);
    useEffect(() => {
        optionsRef.current = layoutOptions;
    }, [layoutOptions]);

    const windowRef = useRef<HTMLDivElement>(null);
    const [layout, setLayout] = useState<WindowLayout>({
        top: defaultTop,
        left: defaultLeft,
        width: defaultWidth,
        height: defaultHeight,
    });
    const [layoutHydrated, setLayoutHydrated] = useState(false);
    const [zIndex, setZIndex] = useState(20);
    const layoutRef = useRef(layout);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hydratedRef = useRef(false);

    const writeLayout = useCallback(() => {
        if (!hydratedRef.current) return;
        const current = optionsRef.current;
        const layouts = readLayouts(current.storageKey);
        layouts[current.layoutId] = {
            top: `${Math.round(layoutRef.current.top)}px`,
            left: `${Math.round(layoutRef.current.left)}px`,
            width: `${Math.round(layoutRef.current.width)}px`,
            height: `${Math.round(layoutRef.current.height)}px`,
        };
        try {
            window.localStorage.setItem(
                current.storageKey,
                JSON.stringify(layouts),
            );
        } catch {
            // Persistência best-effort, como no original.
        }
    }, []);

    const scheduleSave = useCallback(() => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(writeLayout, 300);
    }, [writeLayout]);

    const applyLayout = useCallback(
        (next: WindowLayout, save = true) => {
            const clamped = clampLayout(next, optionsRef.current);
            layoutRef.current = clamped;
            setLayout(clamped);
            if (save && hydratedRef.current) scheduleSave();
        },
        [scheduleSave],
    );

    // Restaura do cache (o original fazia isso no window.onload).
    useEffect(() => {
        const defaults: WindowLayout = {
            top: defaultTop,
            left: defaultLeft,
            width: defaultWidth,
            height: defaultHeight,
        };
        const timer = setTimeout(() => {
            const saved = readLayouts(storageKey)[layoutId];
            const restored = saved
                ? {
                      top: parsePixels(saved.top, defaults.top),
                      left: parsePixels(saved.left, defaults.left),
                      width: parsePixels(saved.width, defaults.width),
                      height: parsePixels(saved.height, defaults.height),
                  }
                : defaults;
            const clamped = clampLayout(restored, optionsRef.current);
            layoutRef.current = clamped;
            setLayout(clamped);
            hydratedRef.current = true;
            setLayoutHydrated(true);
        }, 0);
        return () => clearTimeout(timer);
    }, [
        defaultHeight,
        defaultLeft,
        defaultTop,
        defaultWidth,
        layoutId,
        storageKey,
    ]);

    // O elemento tem `resize: both`; o ResizeObserver descobre o novo tamanho.
    useEffect(() => {
        if (!layoutHydrated) return;
        const element = windowRef.current;
        if (!element) return;
        const target = resizeSelector
            ? element.querySelector<HTMLElement>(resizeSelector)
            : element;
        if (!target) return;

        const observer = new ResizeObserver(() => {
            const width = target.offsetWidth;
            const height = target.offsetHeight;
            if (width <= 0 || height <= 0) return;
            if (
                Math.abs(width - layoutRef.current.width) < 1 &&
                Math.abs(height - layoutRef.current.height) < 1
            ) {
                return;
            }
            applyLayout(
                { ...layoutRef.current, width, height },
                true,
            );
        });
        observer.observe(target);
        return () => observer.disconnect();
    }, [applyLayout, layoutHydrated, resizeSelector]);

    // Reclampa quando a janela ou o zoom mudam (o original fazia o mesmo).
    useEffect(() => {
        if (!layoutHydrated) return;
        const reclamp = () => applyLayout({ ...layoutRef.current }, true);
        const timer = window.setTimeout(reclamp, 60);
        window.addEventListener("resize", reclamp);
        window.addEventListener(SCALE_CHANGED_EVENT, reclamp);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener("resize", reclamp);
            window.removeEventListener(SCALE_CHANGED_EVENT, reclamp);
        };
    }, [applyLayout, layoutHydrated]);

    // Garante gravação no pagehide, mesmo antes do debounce de 300ms.
    useEffect(() => {
        const flush = () => writeLayout();
        window.addEventListener("pagehide", flush);
        window.addEventListener("beforeunload", flush);
        return () => {
            window.removeEventListener("pagehide", flush);
            window.removeEventListener("beforeunload", flush);
            if (saveTimer.current) clearTimeout(saveTimer.current);
        };
    }, [writeLayout]);

    const bringToFront = useCallback(() => {
        nextWindowZIndex = nextWindowZIndex >= 90 ? 21 : nextWindowZIndex + 1;
        setZIndex(nextWindowZIndex);
    }, []);

    const onHeaderMouseDown = useCallback(
        (event: ReactMouseEvent<HTMLElement>) => {
            if (event.button !== 0) return;
            if ((event.target as HTMLElement).closest("button")) return;
            event.preventDefault();
            bringToFront();

            const start = { x: event.clientX, y: event.clientY, ...layoutRef.current };
            const previousUserSelect = document.body.style.userSelect;
            document.body.style.userSelect = "none";
            const shield = document.createElement("div");
            shield.style.cssText =
                "position:fixed;inset:0;z-index:2147483647;cursor:move;background:transparent";
            document.body.appendChild(shield);

            const onMove = (moveEvent: globalThis.MouseEvent) => {
                applyLayout(
                    {
                        ...layoutRef.current,
                        top: start.top + moveEvent.clientY - start.y,
                        left: start.left + moveEvent.clientX - start.x,
                    },
                    false,
                );
            };
            const stop = () => {
                window.removeEventListener("mousemove", onMove, true);
                window.removeEventListener("mouseup", stop, true);
                window.removeEventListener("blur", stop, true);
                const shieldNode = shield.parentNode;
                if (shieldNode) shieldNode.removeChild(shield);
                document.body.style.userSelect = previousUserSelect;
                applyLayout({ ...layoutRef.current }, true);
            };

            window.addEventListener("mousemove", onMove, true);
            window.addEventListener("mouseup", stop, true);
            window.addEventListener("blur", stop, true);
        },
        [applyLayout, bringToFront],
    );

    return {
        layout,
        layoutHydrated,
        windowRef,
        onHeaderMouseDown,
        bringToFront,
        zIndex,
    };
}
