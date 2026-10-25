"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useWindowLayout } from "@/hooks/useWindowLayout";
import { STORAGE_KEYS } from "@/lib/config";

export interface ToolDefaults {
    top: number;
    left: number;
    width: number;
    height: number;
}

interface ToolWindowProps {
    id: string;
    title: string;
    color: string;
    defaults: ToolDefaults;
    minSize?: { width: number; height: number };
    headerStyle?: CSSProperties;
    style?: CSSProperties;
    headerActions?: ReactNode;
    open: boolean;
    onClose: () => void;
    children: ReactNode;
}

/**
 * Janela de ferramenta sempre montada (o original só escondia com
 * display:none). Assim o estado, o terminal e o cache sobrevivem ao fechamento.
 */
export function ToolWindow({
    id,
    title,
    color,
    defaults,
    minSize = { width: 300, height: 280 },
    headerStyle,
    style,
    headerActions,
    open,
    onClose,
    children,
}: ToolWindowProps) {
    const { layout, windowRef, onHeaderMouseDown, bringToFront, zIndex } =
        useWindowLayout({
            storageKey: STORAGE_KEYS.notepadLayouts,
            layoutId: id,
            defaultPosition: { top: defaults.top, left: defaults.left },
            defaultSize: {
                width: defaults.width,
                height: defaults.height,
            },
            minSize,
        });
    const wasOpen = useRef(false);

    useEffect(() => {
        if (open && !wasOpen.current) bringToFront();
        wasOpen.current = open;
    }, [bringToFront, open]);

    return (
        <div
            ref={windowRef}
            id={id}
            className="notepad-window tool-window"
            style={{
                display: open ? "flex" : "none",
                top: layout.top,
                left: layout.left,
                width: layout.width,
                height: layout.height,
                zIndex,
                borderTopColor: color,
                ...style,
            }}
            onMouseDown={bringToFront}
        >
            <div
                className="notepad-header"
                style={headerStyle}
                onMouseDown={onHeaderMouseDown}
            >
                <span style={{ color }}>{title}</span>
                <div className="notepad-header-actions">
                    {headerActions}
                    <button
                        type="button"
                        className="tool-close"
                        onClick={onClose}
                    >
                        ✕
                    </button>
                </div>
            </div>
            <div className="tool-window-body">{children}</div>
        </div>
    );
}
