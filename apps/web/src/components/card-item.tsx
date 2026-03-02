import { component$ } from "@builder.io/qwik";
import type { CardSummary } from "~/lib/types";

interface CardItemProps {
  card: CardSummary;
}

export const CardItem = component$<CardItemProps>(({ card }) => {
  const imageUrl = card.image ? `${card.image}/high.webp` : null;

  return (
    <div class="card-item">
      <div class="card-item__image-wrapper">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={card.name}
            loading="lazy"
            width={245}
            height={342}
          />
        ) : (
          <div class="card-item__placeholder">No Image</div>
        )}
      </div>
      <div class="card-item__info">
        <span class="card-item__name">{card.name}</span>
        {card.set_name && (
          <span class="card-item__set">{card.set_name}</span>
        )}
      </div>
    </div>
  );
});
