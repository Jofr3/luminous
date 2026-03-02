import { component$ } from "@builder.io/qwik";
import { CardItem } from "./card-item";
import type { CardSummary } from "~/lib/types";

interface CardGridProps {
  cards: CardSummary[];
}

export const CardGrid = component$<CardGridProps>(({ cards }) => {
  return (
    <div class="card-grid">
      {cards.map((card) => (
        <CardItem key={card.id} card={card} />
      ))}

      {cards.length === 0 && (
        <p class="card-grid__empty">No cards found. Try a different search.</p>
      )}
    </div>
  );
});
