import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { CSSProperties, ReactNode } from "react";
import type { DragPayload } from "./types";

export function Draggable({
  id,
  payload,
  className,
  children,
  style,
  disabled,
}: {
  id: string;
  payload: DragPayload;
  className?: string;
  children: ReactNode;
  style?: CSSProperties;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    data: payload,
    disabled,
  });

  const dragStyle: CSSProperties = {
    ...style,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    touchAction: "none",
    position: "relative",
    zIndex: isDragging ? 200 : style?.zIndex,
    opacity: disabled ? 0.55 : style?.opacity,
  };

  return (
    <div
      ref={setNodeRef}
      className={className}
      style={dragStyle}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

export function Droppable({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={className}>
      {children}
    </div>
  );
}
