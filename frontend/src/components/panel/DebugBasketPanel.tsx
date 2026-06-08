import { createPortal } from "react-dom";
import type { DebugBasket } from "../../ipc/types";
import {
  type DiagnosticItem,
  type FieldInfo,
  buildBasketSections,
  debugBasketBadgeCount,
  hasDebugBasketContent,
} from "./DebugBasketPanelData";

export { debugBasketBadgeCount, hasDebugBasketContent };

interface DebugBasketPanelProps {
  open: boolean;
  basket: DebugBasket;
}

interface DiagnosticColumnProps {
  title: string;
  description: string;
  tone: "rose" | "amber" | "emerald";
  emptyText: string;
  items: DiagnosticItem[];
}

export function DebugBasketPanel({ open, basket }: DebugBasketPanelProps) {
  if (!open) return null;

  const sections = buildBasketSections(basket);
  const countText = sections.confirmationCount > 0
    ? `有 ${sections.confirmationCount} 项导入内容需要确认`
    : "没有需要确认的导入内容";

  return createPortal(
    <div
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex min-h-0 max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-white/95 shadow-xl backdrop-blur-xl"
      style={{ height: "min(520px, calc(100vh - 6rem))" }}
    >
      <div className="shrink-0 border-b border-border px-3 py-2.5">
        <p className="text-sm font-semibold text-card-foreground">{countText}</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          数字表示需要人工确认的导入内容；它们可能是应用暂时没识别，也可能是已经读取但当前页面还没有展示。
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="grid h-full min-h-0 min-w-[840px] grid-cols-3 overflow-hidden">
          <DiagnosticColumn
            title="没有解析"
            description="应用暂时没识别，只保留了原始内容，方便后续补规则。"
            tone="rose"
            emptyText="暂无这类内容"
            items={sections.unparsed}
          />
          <DiagnosticColumn
            title="已解析，未展示"
            description="应用已经读取并保存，但当前没有任何视图展示这个字段。"
            tone="amber"
            emptyText="暂无这类内容"
            items={sections.hidden}
          />
          <DiagnosticColumn
            title="已解析，已展示"
            description="应用已经读取并保存，下方标注了在哪些视图可以看到。"
            tone="emerald"
            emptyText="暂无这类内容"
            items={sections.visible}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DiagnosticColumn({ title, description, tone, emptyText, items }: DiagnosticColumnProps) {
  const color = {
    rose: "text-rose-800 bg-rose-50",
    amber: "text-amber-800 bg-amber-50",
    emerald: "text-emerald-800 bg-emerald-50",
  }[tone];

  return (
    <section className="flex min-h-0 min-w-0 flex-col border-r border-border last:border-r-0">
      <div className={`shrink-0 border-b border-border px-3 py-2 ${color}`}>
        <p className="truncate text-xs font-semibold">{title}</p>
        <p className="mt-0.5 text-[10px] font-normal leading-snug">{description}</p>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-2">
        {items.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">{emptyText}</p>
        ) : (
          items.map((item) => <DiagnosticCard key={item.id} item={item} />)
        )}
      </div>
    </section>
  );
}

const PLACEMENT_COLORS: Record<string, string> = {
  Graph: "bg-blue-100 text-blue-700",
  Timeline: "bg-violet-100 text-violet-700",
  Chat: "bg-green-100 text-green-700",
  Detail: "bg-orange-100 text-orange-700",
  "Detail · 顶栏": "bg-amber-100 text-amber-700",
  "Detail · 展开区": "bg-yellow-100 text-yellow-700",
  Sidebar: "bg-gray-100 text-gray-600",
  Raw: "bg-slate-100 text-slate-500",
};

function placementColor(placement: string): string {
  return PLACEMENT_COLORS[placement] ?? "bg-gray-50 text-gray-400";
}

function DiagnosticCard({ item }: { item: DiagnosticItem }) {
  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-card-foreground">{item.title}</p>
          {item.note && (
            <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
              {item.note}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
          共 {item.count} 条
        </span>
      </div>
      {item.fields.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {item.fields.map((field) => (
            <FieldRow key={field.label} field={field} />
          ))}
        </div>
      )}
    </div>
  );
}

function FieldRow({ field }: { field: FieldInfo }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="min-w-0 shrink font-mono text-muted-foreground">{field.label}</span>
      <div className="flex flex-wrap gap-0.5">
        {field.placements.map((p) => (
          <span
            key={p}
            className={`px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${placementColor(p)}`}
          >
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}
