import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import { CardItem } from "./card-item";
import type { CardSummary } from "~/lib/types";

interface CardGridProps {
  cards: CardSummary[];
}

export const CardGrid = component$<CardGridProps>(({ cards }) => {
  const gridRef = useSignal<HTMLDivElement>();

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const grid = gridRef.value;
    if (!grid) return;

    let rafId = 0;
    let observer: MutationObserver | null = null;

    cleanup(() => {
      observer?.disconnect();
      cancelAnimationFrame(rafId);
    });

    import("~/lib/card-animate").then(({ animateCards }) => {
      // Capture initial positions
      animateCards(grid);

      observer = new MutationObserver(() => {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => animateCards(grid));
      });

      observer.observe(grid, { childList: true });
    });
  });

  return (
    <div ref={gridRef} class="card-grid">
      {cards.map((card) => (
        <CardItem key={card.id} card={card} />
      ))}

      {cards.length === 0 && (
        <p class="card-grid__empty">No cards found. Try a different search.</p>
      )}
    </div>
  );
});
