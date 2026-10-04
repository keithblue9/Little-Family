import { useEffect, useRef, useState } from "react";

/**
 * Renders its children only once it scrolls near the screen. Cards far below
 * the fold then cost nothing (no request, no render) until someone gets there.
 */
export default function LazyWhenVisible({ children, minHeight = 160, margin = "300px" }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (seen || !ref.current) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: margin });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, margin]);
  return <div ref={ref} style={seen ? undefined : { minHeight }}>{seen ? children : null}</div>;
}
