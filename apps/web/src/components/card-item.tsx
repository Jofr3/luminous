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
          const target = e.target as HTMLElement | null;
          const clientX = e.clientX;
          const clientY = e.clientY;
          const { startTilt, updateTilt, stopTilt } = await import(
            "~/lib/card-tilt"
          );
          const wrapper = target?.closest(
            ".card-item__image-wrapper",
          ) as HTMLElement | null;
          if (!wrapper) return;

          const setTiltFromPointer = (clientX: number, clientY: number) => {
            const rect = wrapper.getBoundingClientRect();
            const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
            const ny = ((clientY - rect.top) / rect.height) * 2 - 1;
            updateTilt(wrapper, nx, ny);
          };

          const onMove = (ev: MouseEvent) => {
            setTiltFromPointer(ev.clientX, ev.clientY);
          };

          const onLeave = () => {
            wrapper.removeEventListener("mousemove", onMove);
            wrapper.removeEventListener("mouseleave", onLeave);
            stopTilt(wrapper);
          };

          wrapper.addEventListener("mousemove", onMove);
          wrapper.addEventListener("mouseleave", onLeave);

          const start = startTilt(wrapper, src);
          setTiltFromPointer(clientX, clientY);
          await start;
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
