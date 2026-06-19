import { memo } from "react";
import type { SessionRow } from "../../ipc/types";
import { formatRelative } from "../../lib/format";

interface SessionCardProps {
  session: SessionRow;
  isActive: boolean;
  selected: boolean;
  selectionMode: boolean;
  onClick: () => void;
  onToggleSelect: () => void;
  cardRef?: (el: HTMLDivElement | null) => void;
  depth?: number;
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

function roleAccent(role: string | null | undefined): string {
  if (!role) return "bg-muted-foreground";
  switch (role.toLowerCase()) {
    case "user": return "bg-accent";
    case "assistant": return "bg-emerald-500";
    case "tool": return "bg-cyan-500";
    case "system": return "bg-pink-500";
    default: return "bg-muted-foreground";
  }
}

export const SessionCard = memo(function SessionCard({
  session, isActive, selected, selectionMode, onClick, onToggleSelect, cardRef,
  depth, hasChildren, isExpanded, onToggleExpand,
}: SessionCardProps) {
  const label = session.title ?? session.agent_nickname ?? session.file_name ?? session.id;
  const ts = session.start_time ?? session.imported_at;
  const dotColor = roleAccent(session.agent_role);
  const indent = depth ? depth * 16 : 0;

  return (
    <div
      ref={cardRef}
      onClick={selectionMode ? onToggleSelect : onClick}
      className={`group relative z-10 w-full text-left rounded-lg px-3 py-2.5 cursor-pointer transition-colors duration-150 border ${
        selected
          ? "border-primary/30 bg-primary/5"
          : isActive
            ? "hover:bg-primary/10 border-transparent"
            : "hover:bg-muted hover:border-border border-transparent"
      }`}
      style={{ paddingLeft: `${12 + indent}px` }}
    >
      <div className="flex items-start gap-3">
        {/* Expand/collapse arrow */}
        {hasChildren && !selectionMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
            className="mt-0.5 shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-muted transition-colors"
            type="button"
            aria-label={isExpanded ? "Collapse children" : "Expand children"}
          >
            <svg
              width="12" height="12" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
              className={`transition-transform duration-200 ${isExpanded ? "rotate-90" : ""} text-muted-foreground`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
        {/* Checkbox — only visible in selection mode */}
        {selectionMode && (
          <div className="mt-0.5 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
              className="w-4 h-4 rounded border-[1.5px] flex items-center justify-center transition-colors"
              style={{
                borderColor: selected ? 'var(--color-primary)' : '#94a3b8',
                backgroundColor: selected ? 'var(--color-primary)' : 'transparent',
              }}
              type="button"
              aria-label={selected ? "Deselect session" : "Select session"}
            >
              {selected && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          </div>
        )}
        <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-medium truncate leading-tight transition-colors duration-150 ${isActive ? "text-on-primary" : "text-card-foreground group-hover:text-foreground"}`}>
            {label}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            {session.agent_role && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium uppercase tracking-wider transition-colors duration-150 ${
                isActive ? "bg-white/15 text-white/80" : "bg-muted text-muted-foreground"
              }`}>
                {session.agent_role}
              </span>
            )}
            {session.is_subagent === 1 && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider transition-colors duration-150 ${
                isActive ? "bg-white/10 text-white/60" : "bg-muted text-muted-foreground/60"
              }`}>
                sub
              </span>
            )}
            <span className={`text-xs transition-colors duration-150 ${isActive ? "text-white/50" : "text-muted-foreground"}`}>{formatRelative(ts)}</span>
          </div>
        </div>
        {isActive && (
          <div className="w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/60">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
});
