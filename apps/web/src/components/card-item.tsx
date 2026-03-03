import { component$ } from "@builder.io/qwik";
import type { CardSummary } from "~/lib/types";
import { imageUrl } from "~/lib/api";

interface CardItemProps {
  card: CardSummary;
}

export const CardItem = component$<CardItemProps>(({ card }) => {
  const src = imageUrl(card.image);

  return (
    <div id={card.id} class="card-item">
      <div class="card-item__image-wrapper">
        {src ? (
          <img
            src={src}
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
