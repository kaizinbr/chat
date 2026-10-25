"use client";

import { useEffect, useState } from "react";

/**
 * Relógio compartilhado pelos slots. O primeiro render acontece no servidor,
 * então o valor inicial é 0 para não gerar hydration mismatch.
 */
export function useNow(intervalMs = 1000) {
    const [now, setNow] = useState(0);

    useEffect(() => {
        const tick = () => setNow(Date.now());
        const initial = window.setTimeout(tick, 0);
        const timer = window.setInterval(tick, intervalMs);
        return () => {
            window.clearTimeout(initial);
            window.clearInterval(timer);
        };
    }, [intervalMs]);

    return now;
}
