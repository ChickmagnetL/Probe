import { kindColor } from "../../lib/color";
import { kindLabel } from "./graph-labels";

interface GraphCanvasControlsProps {
  labelsVisible: boolean;
  onResetView: () => void;
  onToggleLabels: () => void;
  visibleKinds: string[];
  hiddenKinds: Set<string>;
  onToggleKind: (kind: string) => void;
}

export function GraphCanvasControls({
  labelsVisible,
  onResetView,
  onToggleLabels,
  visibleKinds,
  hiddenKinds,
  onToggleKind,
}: GraphCanvasControlsProps) {
  return (
    <>
      <div className="pointer-events-auto absolute bottom-4 right-4 glass-card rounded-xl p-3">
        <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2.5">Legend</div>
        <div className="flex flex-col gap-2 text-xs">
          {visibleKinds.map(kind => (
            <LegendDot
              key={kind}
              color={kindColor(kind)}
              label={kindLabel(kind)}
              isHidden={hiddenKinds.has(kind)}
              onClick={() => onToggleKind(kind)}
            />
          ))}
        </div>
      </div>

      <div className="pointer-events-auto absolute left-4 bottom-4 glass-card rounded-xl p-0.5 flex gap-0.5">
        <button
          type="button"
          onClick={onResetView}
          className="btn-ghost flex items-center gap-1.5"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
          </svg>
          Reset
        </button>
        <div className="w-px bg-border my-1" />
        <button
          type="button"
          onClick={onToggleLabels}
          className="btn-ghost flex items-center gap-1.5"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {labelsVisible ? (
              <>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </>
            ) : (
              <>
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </>
            )}
          </svg>
          {labelsVisible ? "Hide" : "Show"}
        </button>
      </div>
    </>
  );
}

interface LegendDotProps {
  color: string;
  label: string;
  isHidden: boolean;
  onClick: () => void;
}

function LegendDot({ color, label, isHidden, onClick }: LegendDotProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${isHidden ? "Show" : "Hide"} ${label} nodes`}
      className="flex items-center gap-2 text-left text-card-foreground cursor-pointer hover:opacity-80 transition-opacity"
    >
      <div
        className={`rounded-full w-2.5 h-2.5 ${isHidden ? "border-2 bg-transparent" : ""}`}
        style={isHidden ? { borderColor: color } : { backgroundColor: color }}
      />
      <span className={`text-xs font-medium ${isHidden ? "opacity-50" : ""}`}>
        {label}
      </span>
    </button>
  );
}
