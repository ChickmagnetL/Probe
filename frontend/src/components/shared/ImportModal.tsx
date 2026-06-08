import { useEffect, useCallback } from "react";
import { useImportStore } from "../../stores/import";
import { useSessionStore } from "../../stores/session";
import { ProgressBar } from "./ProgressBar";
import { formatTokens } from "../../lib/format";

const IMPORT_DETAIL_LABELS: Record<string, string> = {
  parse_errors: "解析提醒",
  raw_records: "原始导入记录",
  conversation_meta_raw: "会话信息",
  turn_manifest: "回合设置",
  message_items_raw: "消息内容",
  reasoning_items_raw: "思考内容",
  tool_calls_raw: "工具调用",
  tool_call_outputs_raw: "工具输出",
  tool_call_pairs: "工具调用关联",
  telemetry_events: "用量统计",
  lifecycle_events: "任务状态",
  structured_tool_end_events: "工具结果",
  collaboration_events: "子代理协作",
  search_events: "网页搜索",
  system_events: "系统状态",
  compaction_events: "上下文压缩",
};

export function ImportModal() {
  const {
    modalOpen,
    closeModal,
    loading,
    error,
    result,
    inputPath,
    openPicker,
    startImport,
    reset,
  } = useImportStore();
  const fetchSessions = useSessionStore((s) => s.fetchSessions);

  const handleClose = useCallback(() => {
    if (loading) return;
    closeModal();
  }, [loading, closeModal]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, handleClose]);

  // Refresh sessions after successful import
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => {
      closeModal();
      reset();
      fetchSessions();
    }, 1500);
    return () => clearTimeout(timer);
  }, [result, closeModal, reset, fetchSessions]);

  if (!modalOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="relative w-full max-w-xl mx-4 bg-card rounded-lg border border-border shadow-xl animate-scale-in max-h-[85vh] overflow-y-auto">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 btn-ghost p-1.5 z-10 hover:scale-112 active:scale-90 transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          aria-label="Close import dialog"
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="p-8">
          {/* Header */}
          <div className="mb-8 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-md bg-accent mb-4">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                <line x1="12" y1="11" x2="12" y2="17" />
                <line x1="9" y1="14" x2="15" y2="14" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-foreground">Import Files</h2>
            <p className="text-sm text-muted-foreground mt-1.5">
              Select a rollout JSONL file or directory to begin
            </p>
          </div>

          {/* Drop zone */}
          <div className="rounded-md border border-dashed border-border p-8 mb-6 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                  <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
                  <polyline points="13 2 13 9 20 9" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground mb-1">
                  {inputPath ? "File selected" : "Choose files to import"}
                </p>
                {inputPath && (
                  <p className="text-xs text-accent font-mono bg-muted px-3 py-1.5 rounded inline-block">
                    {inputPath}
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => openPicker(true)}
                  className="btn-secondary flex items-center gap-2"
                  type="button"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                  </svg>
                  Select Folder
                </button>
                <button
                  onClick={() => openPicker(false)}
                  className="btn-secondary flex items-center gap-2"
                  type="button"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  Select File
                </button>
              </div>
            </div>
          </div>

          {/* Import button */}
          {inputPath && !result && (
            <div className="mb-6 animate-fade-in">
              <button
                onClick={startImport}
                disabled={loading}
                className={`btn-primary w-full flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed ${loading ? 'animate-spring-bounce' : ''}`}
                type="button"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="13 17 18 12 13 7" />
                      <polyline points="6 17 11 12 6 7" />
                    </svg>
                    Start Import
                  </>
                )}
              </button>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="mb-6 animate-fade-in">
              <ProgressBar value={60} />
              <div className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <div className="w-4 h-4 border-2 border-muted border-t-accent rounded-full animate-spin" />
                Processing files...
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-start gap-3 animate-fade-in">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500 shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              <div>
                <p className="font-semibold text-red-800">Import failed</p>
                <p className="mt-0.5 text-red-600">{error}</p>
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-5 animate-fade-in">
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-md bg-emerald-500 flex items-center justify-center shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-800">Import complete</p>
                  <p className="text-xs text-emerald-600 mt-0.5">{result.imported_session_count} sessions imported successfully</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Files" value={result.total_files} />
                <StatCard label="Records" value={result.parsed_records} />
                <StatCard label="Sessions" value={result.imported_session_count} />
                <StatCard label="Parse Errors" value={result.parse_errors} isError={result.parse_errors > 0} />
                <StatCard label="需确认" value={result.unknown_record_count} isError={result.unknown_record_count > 0} />
                <StatCard label="Root Views" value={result.root_session_count} />
                <StatCard
                  label="Total Tokens"
                  value={formatTokens(
                    result.sessions.reduce(
                      (acc, s) =>
                        acc + s.metrics.total_input_tokens + s.metrics.total_output_tokens,
                      0,
                    ),
                  )}
                  isText
                />
              </div>

              {result.table_counts && Object.keys(result.table_counts).length > 0 && (
                <details className="rounded-md border border-border overflow-hidden group">
                  <summary className="px-4 py-3 text-sm font-medium text-foreground cursor-pointer flex items-center gap-2 hover:bg-muted transition-colors">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground transition-transform group-open:rotate-90">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    导入明细
                  </summary>
                  <div className="border-t border-border px-4 py-3">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                      {Object.entries(result.table_counts).map(([detailKey, count]) => (
                        <div key={detailKey} className="flex justify-between items-center text-sm py-0.5">
                          <span className="text-muted-foreground text-xs">
                            {IMPORT_DETAIL_LABELS[detailKey] ?? "其他导入内容"}
                          </span>
                          <span className="font-semibold text-foreground tabular-nums">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  isText,
  isError,
}: {
  label: string;
  value: number | string;
  isText?: boolean;
  isError?: boolean;
}) {
  return (
    <div className={`rounded-md border p-3 transition-colors ${
      isError
        ? "border-red-200 bg-red-50"
        : "border-border bg-card"
    }`}>
      <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-1">
        {label}
      </div>
      <div className={`font-semibold tabular-nums ${
        isError ? "text-red-600" : "text-foreground"
      } ${isText ? "text-base" : "text-2xl"}`}>
        {value}
      </div>
    </div>
  );
}
