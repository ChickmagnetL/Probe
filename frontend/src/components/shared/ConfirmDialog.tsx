import { useEffect } from "react";
import { useTranslation } from "react-i18next";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  loadingLabel?: string;
  confirmVariant?: "default" | "destructive";
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children?: React.ReactNode;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  loadingLabel,
  confirmVariant = "default",
  loading = false,
  onCancel,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (loading) return;
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, loading]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (loading) return;
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
              className="btn-ghost px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
              disabled={loading}
            >
              {t("confirm.cancel")}
            </button>
            <button
              onClick={onConfirm}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-wait ${
                confirmVariant === "destructive"
                  ? "bg-destructive text-on-destructive hover:bg-destructive/90"
                  : "bg-primary text-on-primary hover:bg-primary/90"
              }`}
              type="button"
              disabled={loading}
            >
              {loading && (
                <svg
                  className="animate-spin h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-90"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              )}
              {loading ? (loadingLabel ?? confirmLabel) : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
