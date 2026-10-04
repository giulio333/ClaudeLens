import { useEffect, useRef, useState } from 'react';

/** How long the pointer rests on a tab before its card opens: long enough that
 *  sweeping across the strip opens nothing. */
export const CARD_DELAY_MS = 450;

/**
 * Which tab the pointer rests on, and where it is. The card follows the pointer
 * from tab to tab without waiting again once one is open, and goes on leaving
 * the strip, on a click and on Esc.
 */
export function useTabHover() {
  const [hover, setHover] = useState<{ id: string; rect: DOMRect } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  useEffect(() => {
    if (!hover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHover(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hover]);

  return {
    hover,
    enter: (id: string, el: HTMLElement) => {
      clear();
      const show = () => setHover({ id, rect: el.getBoundingClientRect() });
      if (hover) show();
      else timer.current = setTimeout(show, CARD_DELAY_MS);
    },
    leave: () => {
      clear();
      setHover(null);
    },
  };
}
