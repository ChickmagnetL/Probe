import { Component, type ReactNode } from "react";
import { i18n } from "../../i18n";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
          <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-destructive">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <p className="text-sm font-medium text-foreground">{i18n.t("error.somethingWrong")}</p>
          <p className="text-xs text-muted-foreground">{this.state.error?.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-2 btn-secondary"
          >
            {i18n.t("error.tryAgain")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
