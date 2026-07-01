import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";

interface FilterBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  onCompositionChange?: (composing: boolean) => void;
  sort: string;
  onSortChange: (v: string) => void;
  sortOptions: { value: string; label: string }[];
  /** Extra buttons (import/delete) rendered to the left of the search button.
      Hidden while the search input is expanded so the input can take their place. */
  children?: ReactNode;
}

export function FilterBar({
  search,
  onSearchChange,
  onCompositionChange,
  sort,
  onSortChange,
  sortOptions,
  children,
}: FilterBarProps) {
  const { t } = useTranslation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  // Search is "active" when toggled open OR while a query remains, so the
  // user can keep editing/clearing even when a search yields no matches.
  const searchActive = searchOpen || !!search;

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (!sortOpen) return;
    const close = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [sortOpen]);

  const toggleSearch = () => {
    if (searchOpen) {
      // Closing: clear the query and collapse the input so children return.
      setSearchOpen(false);
      onSearchChange("");
    } else {
      setSearchOpen(true);
    }
  };

  return (
    <div className="flex items-center gap-1 min-w-0 flex-1 justify-end pr-1 -mr-3">
      {/* Flex zone: shows EITHER the input (when search active) OR the
          children (import/delete). The input expands over the children's
          position; the always-present search button toggles between them. */}
      {searchActive ? (
        <div className="relative flex-1 min-w-0">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onCompositionStart={() => onCompositionChange?.(true)}
            onCompositionEnd={(e) => {
              onCompositionChange?.(false);
              // Some WebKit builds do not fire the trailing onChange after
              // compositionend, which would drop the confirmed text. Push the
              // committed value explicitly; it is idempotent under React's
              // controlled-input setState when onChange also fires.
              onSearchChange(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchOpen(false);
                onSearchChange("");
              }
            }}
            placeholder={t("filter.searchPlaceholder")}
            className="w-full rounded-lg border border-border bg-card pl-8 pr-2 py-1.5 text-xs
                       placeholder:text-muted-foreground text-foreground
                       focus:outline-none focus:ring-1 focus:ring-ring/30 focus:border-primary
                       transition-all duration-150"
          />
        </div>
      ) : (
        <div className="flex items-center gap-1 min-w-0">{children}</div>
      )}

      {/* Search toggle button - always visible. Shows the "on" style while active. */}
      <button
        onClick={toggleSearch}
        className={`btn-ghost p-1.5 ${searchActive ? "bg-muted text-foreground" : ""}`}
        aria-label={t("filter.searchSessions")}
        type="button"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      </button>

      {/* Sort */}
      <div className="relative" ref={sortRef}>
        <button
          onClick={() => setSortOpen((v) => !v)}
          className="btn-ghost p-1.5"
          aria-label={t("filter.sortSessions")}
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="16" y2="6" />
            <line x1="4" y1="12" x2="12" y2="12" />
            <line x1="4" y1="18" x2="8" y2="18" />
          </svg>
        </button>

        {sortOpen && (
          <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[120px] animate-fade-in">
            {sortOptions.map((o) => (
              <button
                key={o.value}
                onClick={() => { onSortChange(o.value); setSortOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                  o.value === sort
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                type="button"
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
