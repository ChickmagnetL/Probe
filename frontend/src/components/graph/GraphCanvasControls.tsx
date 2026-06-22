interface GraphCanvasControlsProps {
  labelsVisible: boolean;
  onResetView: () => void;
  onToggleLabels: () => void;
}

export function GraphCanvasControls({
  labelsVisible,
  onResetView,
  onToggleLabels,
}: GraphCanvasControlsProps) {
  return (
    <>
      <div className="pointer-events-auto absolute top-4 right-4 glass-card rounded-xl p-3">
        <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2.5">Legend</div>
        <div className="flex flex-col gap-2 text-xs">
          <LegendDot color="#3b82f6" label="Input (anchor)" />
          <LegendDot color="#10b981" label="Output (anchor)" />
          <LegendDot color="#f59e0b" label="Tool call" small />
          <LegendDot color="#a855f7" label="Tool result" small />
          <LegendDot color="#6b7280" label="Reasoning" small />
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
  small?: boolean;
}

function LegendDot({ color, label, small }: LegendDotProps) {
  return (
    <div className="flex items-center gap-2 text-card-foreground">
      <div
        className={`rounded-full ${small ? "w-1.5 h-1.5" : "w-2.5 h-2.5"}`}
        style={{ backgroundColor: color }}
      />
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}
