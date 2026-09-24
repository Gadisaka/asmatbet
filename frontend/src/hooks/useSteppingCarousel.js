import { useEffect } from "react";

const STEP_MS = 3200;
const RESET_MS = 700;

/**
 * Scrolls a horizontal card row forward by one card, then jumps back to the
 * start once the duplicated set has taken the first card's place.
 */
export function useSteppingCarousel(scrollerRef, count) {
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || count < 2) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }

    let index = 0;
    let resetTimer = 0;
    let paused = false;

    const stepSize = () => {
      const card = node.querySelector("[data-carousel-card]");
      if (!card) return 0;
      const styles = getComputedStyle(node);
      const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0;
      return card.getBoundingClientRect().width + gap;
    };

    const tick = () => {
      if (paused || document.hidden) return;
      const step = stepSize();
      if (!step) return;
      index += 1;
      node.scrollTo({ left: index * step, behavior: "smooth" });
      if (index >= count) {
        window.clearTimeout(resetTimer);
        resetTimer = window.setTimeout(() => {
          node.scrollTo({ left: 0, behavior: "auto" });
          index = 0;
        }, RESET_MS);
      }
    };

    const onEnter = () => {
      paused = true;
    };
    const onLeave = () => {
      paused = false;
    };

    node.addEventListener("pointerenter", onEnter);
    node.addEventListener("pointerleave", onLeave);
    const timer = window.setInterval(tick, STEP_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(resetTimer);
      node.removeEventListener("pointerenter", onEnter);
      node.removeEventListener("pointerleave", onLeave);
    };
  }, [scrollerRef, count]);
}
