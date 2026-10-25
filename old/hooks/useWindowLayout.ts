'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

interface WindowLayout {
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
  defaultPosition: Pick<WindowLayout, 'top' | 'left'>;
  defaultSize: Pick<WindowLayout, 'width' | 'height'>;
  minSize: Pick<WindowLayout, 'width' | 'height'>;
  resizeSelector?: string;
}

let nextWindowZIndex = 81;

const parsePixels = (value: string | number | undefined, fallback: number) => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readLayouts = (key: string): Record<string, StoredLayout> => {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
};

const clampLayout = (
  layout: WindowLayout,
  options: UseWindowLayoutOptions,
): WindowLayout => {
  const appScale = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--app-scale'),
  ) || 1;
  const viewportWidth = window.innerWidth / appScale;
  const viewportHeight = window.innerHeight / appScale;
  const width = Math.max(options.minSize.width, layout.width);
  const height = Math.max(options.minSize.height, layout.height);

  return {
    width,
    height,
    top: Math.max(2, Math.min(layout.top, Math.max(2, viewportHeight - height))),
    left: Math.max(2, Math.min(layout.left, Math.max(2, viewportWidth - width))),
  };
};

export function useWindowLayout(options: UseWindowLayoutOptions) {
  const defaultTop = options.defaultPosition.top;
  const defaultLeft = options.defaultPosition.left;
  const defaultWidth = options.defaultSize.width;
  const defaultHeight = options.defaultSize.height;
  const minWidth = options.minSize.width;
  const minHeight = options.minSize.height;
  const { layoutId, resizeSelector, storageKey } = options;
  const layoutOptions = useMemo(() => ({
    defaultPosition: { top: defaultTop, left: defaultLeft },
    defaultSize: { width: defaultWidth, height: defaultHeight },
    minSize: { width: minWidth, height: minHeight },
    layoutId,
    resizeSelector,
    storageKey,
  }), [
    defaultHeight,
    defaultLeft,
    defaultTop,
    defaultWidth,
    layoutId,
    minHeight,
    minWidth,
    resizeSelector,
    storageKey,
  ]);
  const windowRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<WindowLayout>({
    top: defaultTop,
    left: defaultLeft,
    width: defaultWidth,
    height: defaultHeight,
  });
  const [layoutHydrated, setLayoutHydrated] = useState(false);
  const [zIndex, setZIndex] = useState(80);
  const layoutRef = useRef(layout);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const defaults = {
      top: defaultTop,
      left: defaultLeft,
      width: defaultWidth,
      height: defaultHeight,
    };
    const restore = setTimeout(() => {
      const saved = readLayouts(storageKey)[layoutId];
      const restored = saved
        ? clampLayout({
            top: parsePixels(saved.top, defaults.top),
            left: parsePixels(saved.left, defaults.left),
            width: parsePixels(saved.width, defaults.width),
            height: parsePixels(saved.height, defaults.height),
          }, layoutOptions)
        : defaults;

      layoutRef.current = restored;
      setLayout(restored);
      setLayoutHydrated(true);
    }, 0);
    return () => clearTimeout(restore);
  }, [defaultHeight, defaultLeft, defaultTop, defaultWidth, layoutId, layoutOptions, storageKey]);

  const updateLayout = useCallback((next: WindowLayout, save = true) => {
    const clamped = clampLayout(next, layoutOptions);
    layoutRef.current = clamped;
    setLayout(clamped);
    if (!save) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const layouts = readLayouts(layoutOptions.storageKey);
      layouts[layoutOptions.layoutId] = {
        top: `${layoutRef.current.top}px`,
        left: `${layoutRef.current.left}px`,
        width: `${layoutRef.current.width}px`,
        height: `${layoutRef.current.height}px`,
      };
      try {
        window.localStorage.setItem(layoutOptions.storageKey, JSON.stringify(layouts));
      } catch {
        // Layout persistence is best effort when storage is unavailable.
      }
    }, 300);
  }, [
    layoutOptions,
  ]);

  useEffect(() => {
    if (!layoutHydrated) return;
    const element = windowRef.current;
    if (!element) return;
    const resizeTarget = layoutOptions.resizeSelector
      ? element.querySelector<HTMLElement>(layoutOptions.resizeSelector)
      : element;
    if (!resizeTarget) return;

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = resizeTarget.offsetWidth;
      const height = resizeTarget.offsetHeight;
      if (width <= 0 || height <= 0) return;
      updateLayout({
        ...layoutRef.current,
        width,
        height,
      });
    });
    observer.observe(resizeTarget);
    return () => observer.disconnect();
  }, [layoutHydrated, layoutOptions.resizeSelector, updateLayout]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const bringToFront = useCallback(() => {
    nextWindowZIndex += 1;
    setZIndex(nextWindowZIndex);
  }, []);

  function onHeaderMouseDown(event: ReactMouseEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    bringToFront();

    const start = { x: event.clientX, y: event.clientY, ...layoutRef.current };
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    const shield = document.createElement('div');
    shield.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:move;background:transparent';
    document.body.appendChild(shield);

    const onMove = (moveEvent: globalThis.MouseEvent) => {
      updateLayout({
        ...layoutRef.current,
        top: start.top + moveEvent.clientY - start.y,
        left: start.left + moveEvent.clientX - start.x,
      });
    };
    const stop = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', stop, true);
      window.removeEventListener('blur', stop, true);
      if (shield.parentNode) shield.parentNode.removeChild(shield);
      document.body.style.userSelect = previousUserSelect;
      updateLayout(layoutRef.current);
    };

    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', stop, true);
    window.addEventListener('blur', stop, true);
  }

  return { layout, windowRef, onHeaderMouseDown, bringToFront, zIndex };
}
