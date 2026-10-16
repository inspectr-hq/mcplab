import { useLayoutEffect, useState, type RefObject } from 'react';

const BOTTOM_GAP_PX = 24;
const MIN_HEIGHT_PX = 448;

/**
 * The height that lets an element reach from where it starts on the page down to the bottom
 * of the viewport, so a side panel below other content still shows its last line (an input)
 * without scrolling. Only applies at `query`; elsewhere returns undefined so CSS decides.
 * Re-measures when the window or the content above the element (`observe`) changes size.
 */
export function useHeightToViewportBottom(
  ref: RefObject<HTMLElement | null>,
  {
    active,
    observe,
    query = '(min-width: 1280px)'
  }: {
    active: boolean;
    observe?: RefObject<HTMLElement | null>;
    query?: string;
  }
): number | undefined {
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    if (!active) {
      setHeight(undefined);
      return;
    }
    const media = window.matchMedia?.(query);
    const measure = () => {
      const element = ref.current;
      if (!element || (media && !media.matches)) return setHeight(undefined);
      setHeight(
        Math.max(MIN_HEIGHT_PX, Math.round(window.innerHeight - pageTop(element) - BOTTOM_GAP_PX))
      );
    };
    measure();
    window.addEventListener('resize', measure);
    media?.addEventListener?.('change', measure);
    const observer =
      observe?.current && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(measure)
        : undefined;
    if (observe?.current) observer?.observe(observe.current);
    return () => {
      window.removeEventListener('resize', measure);
      media?.removeEventListener?.('change', measure);
      observer?.disconnect();
    };
  }, [active, observe, query, ref]);

  return height;
}

/** Distance from the top of the page, whichever ancestor (the document included) is scrolled. */
function pageTop(element: HTMLElement): number {
  let top = element.getBoundingClientRect().top;
  for (let parent = element.parentElement; parent; parent = parent.parentElement)
    top += parent.scrollTop;
  return top;
}
