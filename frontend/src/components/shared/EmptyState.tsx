interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  showShortcut?: boolean;
}

export function EmptyState({ title, description, action, showShortcut }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-16 text-center">
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      </div>
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="mt-1.5 text-sm text-muted-foreground max-w-xs leading-relaxed">{description}</p>
        )}
        {showShortcut && (
          <p className="text-xs text-muted-foreground mt-2">Press ⌘I to import files</p>
        )}
      </div>
      {action}
    </div>
  );
}
