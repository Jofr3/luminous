import type { CardSummary } from "~/lib/types";
import { imageUrl } from "~/lib/api";

interface CardItemProps {
  card: CardSummary;
}

export function CardItem({ card }: CardItemProps) {
  const src = imageUrl(card.image);

  return (
    <div id={card.id} className="card-item">
      <div
        className="card-item__image-wrapper"
        onMouseEnter={async (e) => {
          const target = e.target as HTMLElement | null;
          const clientX = e.clientX;
          const clientY = e.clientY;
          const { startTilt, updateTilt, stopTilt } = await import("~/lib/card-tilt");
          const wrapper = target?.closest(".card-item__image-wrapper") as HTMLElement | null;
          if (!wrapper || !src) return;

          const setTiltFromPointer = (cx: number, cy: number) => {
            const rect = wrapper.getBoundingClientRect();
            const nx = ((cx - rect.left) / rect.width) * 2 - 1;
            const ny = ((cy - rect.top) / rect.height) * 2 - 1;
            updateTilt(nx, ny);
          };

          const onMove = (ev: MouseEvent) => {
            setTiltFromPointer(ev.clientX, ev.clientY);
          };

          const onLeave = () => {
            wrapper.removeEventListener("mousemove", onMove);
            wrapper.removeEventListener("mouseleave", onLeave);
            stopTilt();
          };

          wrapper.addEventListener("mousemove", onMove);
          wrapper.addEventListener("mouseleave", onLeave);

          const start = startTilt(wrapper, src);
          setTiltFromPointer(clientX, clientY);
          await start;
        }}
      >
        <img
          src={src ?? ""}
          alt={card.name}
          loading="lazy"
          crossOrigin="anonymous"
          width={245}
          height={342}
        />
      </div>
    </div>
  );
}
