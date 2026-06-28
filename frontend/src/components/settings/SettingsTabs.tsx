import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export type SettingsTab = "general" | "interface" | "update";

interface SettingsTabsProps {
  active: SettingsTab;
  onChange: (tab: SettingsTab) => void;
}

const TABS: SettingsTab[] = ["general", "interface", "update"];

export function SettingsTabs({ active, onChange }: SettingsTabsProps) {
  const { t } = useTranslation();
  const indicatorRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const updateIndicator = useCallback(() => {
    if (!tabsRef.current || !indicatorRef.current) return;
    const activeTab = tabsRef.current.querySelector(
      `[data-tab="${active}"]`,
    ) as HTMLElement | null;
    if (activeTab) {
      indicatorRef.current.style.width = `${activeTab.offsetWidth}px`;
      indicatorRef.current.style.transform = `translateX(${activeTab.offsetLeft}px)`;
    }
  }, [active]);

  useEffect(() => {
    // Double-rAF ensures the browser has finished layout after text changes
    // (e.g. language switch) before we measure tab dimensions.
    let secondFrame: number;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(updateIndicator);
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [updateIndicator, t]);

  const label = (tab: SettingsTab) =>
    tab === "general"
      ? t("settings.general")
      : tab === "interface"
        ? t("settings.interface")
        : t("settings.update");

  return (
    <div className="liquid-glass rounded-full p-0.5 flex items-center relative inline-flex">
      <div ref={tabsRef} className="relative flex items-center">
        <div
          ref={indicatorRef}
          className="absolute top-0.5 bottom-0.5 left-0 rounded-full bg-primary/90 transition-all duration-300 ease-out"
        />
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            data-tab={tab}
            onClick={() => onChange(tab)}
            className="flex-shrink-0 py-1 px-4 text-[11px] font-semibold rounded-full relative z-10 transition-colors duration-200 text-center"
            style={{
              color:
                tab === active
                  ? "var(--color-on-primary, #FFFFFF)"
                  : "var(--color-muted-foreground, #64748B)",
            }}
          >
            {label(tab)}
          </button>
        ))}
      </div>
    </div>
  );
}
