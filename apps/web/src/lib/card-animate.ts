import gsap from "gsap";

let prevRects = new Map<string, DOMRect>();
let tl: gsap.core.Timeline | null = null;
let initialized = false;

export function animateCards(grid: HTMLElement) {
  const items = Array.from(
    grid.querySelectorAll<HTMLElement>(".card-item"),
  );

  if (items.length === 0) {
    prevRects.clear();
    return;
  }

  // Snap any running animation to its end state
  if (tl) {
    tl.progress(1).kill();
    tl = null;
  }

  // Capture current natural positions
  const rects = new Map<string, DOMRect>();
  for (const el of items) {
    rects.set(el.id, el.getBoundingClientRect());
  }

  // First call — just capture positions, skip animation (avoids SSR flash)
  if (!initialized) {
    initialized = true;
    prevRects = rects;
    return;
  }

  const timeline = gsap.timeline();
  const entering: HTMLElement[] = [];

  for (const el of items) {
    const prev = prevRects.get(el.id);
    const curr = rects.get(el.id)!;

    if (prev) {
      // Card existed before — animate from old position to new
      const dx = prev.left - curr.left;
      const dy = prev.top - curr.top;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        timeline.fromTo(
          el,
          { x: dx, y: dy },
          { x: 0, y: 0, duration: 0.4, ease: "power2.out" },
          0,
        );
      }
    } else {
      entering.push(el);
    }
  }

  if (entering.length > 0) {
    // Cap total stagger spread at 0.5s regardless of card count
    const stagger = Math.min(0.02, 0.5 / entering.length);
    timeline.fromTo(
      entering,
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, duration: 0.35, stagger, ease: "power2.out" },
      0,
    );
  }

  tl = timeline;
  prevRects = rects;
}
