import { memo } from "react";

interface DateBucketProps {
  label: string;
  collapsed: boolean;
  count: number;
  onToggle: () => void;
}

// Date bucket header — smaller, more muted than the project folder row.
// Visual baseline: `.date-bucket` / `.db-*` in the fusion preview.
function DateBucketComponent({ label, collapsed, count, onToggle }: DateBucketProps) {
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
      aria-expanded={!collapsed}
      aria-label={collapsed ? `Expand ${label} bucket` : `Collapse ${label} bucket`}
      className="flex items-center gap-2 pt-1.5 pb-1 mt-1.5 cursor-pointer"
    >
      <span
        className={`inline-flex items-center justify-center text-muted-foreground transition-transform duration-200 ${collapsed ? "" : "rotate-90"}`}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
      <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="text-[10px] text-muted-foreground/70 tabular-nums">
        {count}
      </span>
    </div>
  );
}

export const DateBucket = memo(DateBucketComponent);
