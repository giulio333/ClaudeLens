import { useEffect, useState } from 'react';

/**
 * The time a "12 min" label is measured against. Nothing on disk changes while
 * a background shell just runs, so the minutes can't ride the watcher; a coarse
 * tick of its own keeps them honest, and stops when there is nothing to count.
 */
export function useMinuteClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
