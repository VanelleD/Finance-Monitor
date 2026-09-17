import { useEffect, useRef, useState } from "react";

/**
 * Measures an element so charts can be drawn in real pixels.
 *
 * Scaling an SVG with `preserveAspectRatio="none"` would stretch strokes and
 * end-dots out of spec, so the geometry is recomputed on resize instead.
 */
export function useSize<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
