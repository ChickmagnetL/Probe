interface ProjectGroupProps {
  name: string;
  fullPath: string | null;
  collapsed: boolean;
  count: number;
  onToggle: () => void;
}

export function ProjectGroup({ name, fullPath, collapsed, count, onToggle }: ProjectGroupProps) {
  return (
    <div
      className="flex items-center gap-1.5 px-1 mt-3 mb-0.5 first:mt-0"
      title={fullPath ?? undefined}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-muted transition-colors"
        type="button"
        aria-label={collapsed ? "Expand project group" : "Collapse project group"}
        aria-expanded={!collapsed}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform duration-200 ${collapsed ? "" : "rotate-90"} text-muted-foreground`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
        {name}
      </span>
      <span className="text-[10px] text-muted-foreground/70 tabular-nums">{count}</span>
    </div>
  );
}
