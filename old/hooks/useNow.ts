'use client';
import { useEffect, useState } from 'react';

/** Re-renderiza a cada `intervalMs` — usado pelos timers dos slots. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const initial = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      clearTimeout(initial);
      clearInterval(t);
    };
  }, [intervalMs]);
  return now;
}
