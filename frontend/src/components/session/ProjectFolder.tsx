import { memo } from "react";

interface ProjectFolderProps {
  name: string;
  fullPath: string | null;
  collapsed: boolean;
  count: number;
  latestRelative: string | null;
  onToggle: () => void;
}

// Project folder row — tree node, not a card. Visual baseline comes from
// /tmp/probe-grouping-fusion.html `.project-row` / `.pg-*` styles.
// Softened palette: folder icon fill #DBEAFE + stroke #93C5FD, count pill
// #F1F5F9 bg + #64748B text, latest-active hint on the right.
function ProjectFolderComponent({
  name,
  fullPath,
  collapsed,
  count,
  latestRelative,
  onToggle,
}: ProjectFolderProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }
      }}
      title={fullPath ?? undefined}
      aria-expanded={!collapsed}
      aria-label={collapsed ? `Expand project ${name}` : `Collapse project ${name}`}
      className="group flex items-center gap-2 h-10 px-1.5 mt-2.5 first:mt-0 rounded-lg cursor-pointer hover:bg-muted transition-colors"
    >
      <span
        className={`shrink-0 inline-flex items-center justify-center text-muted-foreground transition-transform duration-200 ${collapsed ? "" : "rotate-90"}`}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
      <span className="shrink-0 inline-flex items-center justify-center">
        <svg
          width="18" height="18" viewBox="0 0 24 24"
          fill="#DBEAFE" stroke="#93C5FD" strokeWidth="1.3"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      </span>
      <span className="text-sm font-medium text-foreground truncate min-w-0">
        {name}
      </span>
      <span className="text-[11px] text-muted-foreground tabular-nums bg-muted px-1.5 py-px rounded-full shrink-0">
        {count}
      </span>
      {latestRelative && (
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums whitespace-nowrap shrink-0">
          {latestRelative}
        </span>
      )}
    </div>
  );
}

export const ProjectFolder = memo(ProjectFolderComponent);
