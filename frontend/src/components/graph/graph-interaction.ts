export interface Transform {
  x: number;
  y: number;
  k: number;
}

export function createInteractionHandlers(
  canvas: HTMLCanvasElement,
  getTransform: () => Transform,
  setTransform: (t: Transform) => void,
  onHover: (x: number, y: number) => void,
  onClick: (x: number, y: number) => void,
  onMouseLeave?: () => void,
) {
  let isPanning = false;
  let startX = 0;
  let startY = 0;
  let startTx = 0;
  let startTy = 0;

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    isPanning = true;
    startX = e.clientX;
    startY = e.clientY;
    const t = getTransform();
    startTx = t.x;
    startTy = t.y;
    canvas.style.cursor = "grabbing";
  }

  function onMouseMove(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (isPanning) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      setTransform({ ...getTransform(), x: startTx + dx, y: startTy + dy });
    } else {
      onHover(mx, my);
    }
  }

  function onMouseUp(e: MouseEvent) {
    if (!isPanning) return;
    isPanning = false;
    canvas.style.cursor = "grab";

    // If barely moved, treat as click
    const dx = Math.abs(e.clientX - startX);
    const dy = Math.abs(e.clientY - startY);
    if (dx < 3 && dy < 3) {
      const rect = canvas.getBoundingClientRect();
      onClick(e.clientX - rect.left, e.clientY - rect.top);
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const t = getTransform();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newK = Math.max(0.1, Math.min(5, t.k * delta));

    // Zoom toward cursor
    const newX = mx - (mx - t.x) * (newK / t.k);
    const newY = my - (my - t.y) * (newK / t.k);

    setTransform({ x: newX, y: newY, k: newK });
  }

  function onDblClick() {
    // Reset view
    setTransform({ x: 0, y: 0, k: 1 });
  }

  function handleMouseLeave() {
    onMouseLeave?.();
  }

  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("mouseleave", handleMouseLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDblClick);

  return () => {
    canvas.removeEventListener("mousedown", onMouseDown);
    canvas.removeEventListener("mousemove", onMouseMove);
    canvas.removeEventListener("mouseup", onMouseUp);
    canvas.removeEventListener("mouseleave", handleMouseLeave);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("dblclick", onDblClick);
  };
}
