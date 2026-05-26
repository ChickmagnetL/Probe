import { useEffect } from "react";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  confirmVariant?: "default" | "destructive";
  onCancel: () => void;
  onConfirm: () => void;
  children?: React.ReactNode;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmVariant = "default",
  onCancel,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="relative w-full max-w-md mx-4 bg-card rounded-lg border border-border shadow-xl animate-scale-in">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-2">{title}</h2>
          <p className="text-sm text-muted-foreground">{message}</p>
          {children}
          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={onCancel}
              className="btn-ghost px-4 py-2"
              type="button"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                confirmVariant === "destructive"
                  ? "bg-destructive text-on-destructive hover:bg-destructive/90"
                  : "bg-primary text-on-primary hover:bg-primary/90"
              }`}
              type="button"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
