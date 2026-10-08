"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Mount a child the first time it comes near the viewport, and hold its place until then.
 *
 * Written for the Analytics page, where ten recharts charts mount at once and only the first row is
 * on screen. Measured on a production build, opening that page blocked the main thread for 200–700 ms
 * (long tasks of 325 ms and 313 ms on one visit) even though the page itself painted in 31 ms — the
 * rows, the charts and the breakdown tables all landed in the same frame, and recharts animates every
 * chart as it mounts. Nothing below the fold needed to be there yet.
 *
 * The placeholder is deliberately *invisible but sized*: `height` is the height the child will occupy,
 * so the page keeps its scroll length and nothing shifts when a chart arrives. That matters more than
 * a spinner would — a smaller placeholder would move every row below it as each chart mounted, which
 * is the jitter this is supposed to remove.
 *
 * Three ways to be shown, and the redundancy is the point. Whether an `IntersectionObserver` callback
 * arrives depends on the browser producing frames, and that is not something to bet a chart on: an
 * occluded window, a background tab, a headless capture or a print view can leave callbacks pending
 * indefinitely — during this component's own testing, an observer did not fire once in the browser
 * that was measuring it, for an element plainly inside the viewport, and the charts it was guarding
 * stayed blank. So:
 *
 *   * **Already in reach — mounted on the spot**, from the element's own bounding box, with no
 *     callback to wait for. This is what covers the charts someone can see right now.
 *   * **Scrolled into reach — mounted from the same check on a passive scroll or resize**, which costs
 *     one `getBoundingClientRect` per event and is the safety net for a broken observer. It cannot be
 *     throttled with `requestAnimationFrame`, because no frames is exactly the failure it is there for.
 *   * **IntersectionObserver otherwise**, which is what makes the common case cheap: it looks 400 px
 *     ahead of the scroll, so a chart is drawn by the time it is read rather than as its first pixel
 *     appears. A browser without the API at all is shown the child immediately, as is a check script,
 *     which has no layout to intersect with.
 *
 * Once shown, the listeners go: charts are re-mounted by a navigation anyway, so re-hiding one that
 * has been seen would throw the work away rather than save it.
 */
export function OnScreen({ height, children, rootMargin = "400px" }: {
  /** The height, in pixels, the child reserves before it mounts — its own height, not a guess. */
  height: number;
  children: React.ReactNode;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) {
      setShown(true);
      return;
    }
    const reach = Number.parseInt(rootMargin, 10) || 0;
    const inReach = () => el.getBoundingClientRect().top - reach < (window.innerHeight || 0);

    if (inReach()) {
      setShown(true);
      return;
    }

    const onScrollOrResize = () => { if (inReach()) setShown(true); };
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) setShown(true);
      }, { rootMargin });
      observer.observe(el);
    }

    return () => {
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      observer?.disconnect();
    };
  }, [shown, rootMargin]);

  return (
    <div ref={ref} style={shown ? undefined : { height }}>
      {shown ? children : null}
    </div>
  );
}
