import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface TitleDragRegionProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

function handleTitleDragMouseDown(event: MouseEvent<HTMLDivElement>) {
  if (event.button !== 0) return;

  void getCurrentWindow().startDragging().catch(() => undefined);
}

export function TitleDragRegion({ children, className, style }: TitleDragRegionProps) {
  return (
    <div className={className} style={style} onMouseDown={handleTitleDragMouseDown}>
      {children}
    </div>
  );
}
