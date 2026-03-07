import { CardItem } from "./card-item";
import type { CardSummary } from "~/lib/types";

interface CardGridProps {
  cards: CardSummary[];
}

export function CardGrid({ cards }: CardGridProps) {
  return (
    <div className="card-grid">
      {cards.map((card) => (
        <CardItem key={card.id} card={card} />
      ))}

      {cards.length === 0 && (
        <p className="card-grid__empty">No cards found. Try a different search.</p>
      )}
    </div>
  );
}
