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
      <div
        class="card-item__image-wrapper"
        onMouseEnter$={async (e: MouseEvent) => {
          if (!src) return;
          const { startTilt, updateTilt, stopTilt } = await import(
            "~/lib/card-tilt"
          );
          const wrapper = (e.target as HTMLElement).closest(
            ".card-item__image-wrapper",
          ) as HTMLElement;
          if (!wrapper) return;

          await startTilt(wrapper, src);

          const onMove = (ev: MouseEvent) => {
            const rect = wrapper.getBoundingClientRect();
            const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
            const ny = ((ev.clientY - rect.top) / rect.height) * 2 - 1;
            updateTilt(nx, ny);
          };

          const onLeave = () => {
            wrapper.removeEventListener("mousemove", onMove);
            wrapper.removeEventListener("mouseleave", onLeave);
            stopTilt();
          };

          wrapper.addEventListener("mousemove", onMove);
          wrapper.addEventListener("mouseleave", onLeave);
        }}
      >
        {src ? (
          <img
            src={src}
            alt={card.name}
            loading="lazy"
            crossOrigin="anonymous"
            width={245}
            height={342}
          />
        ) : (
          <div class="card-item__placeholder">No Image</div>
        )}
      </div>
    </div>
  );
});
