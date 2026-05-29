import { useEffect, useRef } from "react";

interface SplitMenuProps {
  open: boolean;
  onSplitRight: () => void;
  onSplitDown: () => void;
  onClose: () => void;
}

export function SplitMenu({ open, onSplitRight, onSplitDown, onClose }: SplitMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Use setTimeout to avoid the opening click itself triggering close
    const id = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className="absolute left-[calc(100%+6px)] top-0 bg-white/95 backdrop-blur-xl border border-border rounded-[9px] p-1 min-w-[150px] z-30 shadow-lg"
    >
      <button
        type="button"
        className="flex items-center gap-2.5 w-full px-2.5 py-[7px] text-[11.5px] font-medium text-foreground rounded-md hover:bg-primary/10 hover:text-primary transition-colors"
        onClick={onSplitRight}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="8" height="16" rx="1" />
          <rect x="13" y="4" width="8" height="16" rx="1" />
        </svg>
        <span>Split Right</span>
      </button>
      <button
        type="button"
        className="flex items-center gap-2.5 w-full px-2.5 py-[7px] text-[11.5px] font-medium text-foreground rounded-md hover:bg-primary/10 hover:text-primary transition-colors"
        onClick={onSplitDown}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="8" rx="1" />
          <rect x="3" y="13" width="18" height="8" rx="1" />
        </svg>
        <span>Split Down</span>
      </button>
    </div>
  );
}
