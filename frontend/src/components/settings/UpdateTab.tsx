import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownContent } from "../shared/MarkdownContent";
import { ProgressBar } from "../shared/ProgressBar";
import { toIpcError } from "../../ipc/errors";
import { invoke } from "../../ipc/invoke";
import type { AppInfo, IpcError, UpdateInfo, UpdateStatus } from "../../ipc/types";

interface UpdateTabProps {
  active: boolean;
}

interface DownloadProgressState {
  downloaded: number;
  total: number | null;
}

const EMPTY_PROGRESS: DownloadProgressState = {
  downloaded: 0,
  total: null,
};

const MIN_CHECKING_STATE_MS = 400;
let nextUpdateCheckToken = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function UpdateTab({ active }: UpdateTabProps) {
  const { t } = useTranslation();
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [status, setStatus] = useState<UpdateStatus>("checking");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<IpcError | null>(null);
  const [progress, setProgress] = useState<DownloadProgressState>(EMPTY_PROGRESS);
  const activeRef = useRef(active);
  const mountedRef = useRef(true);
  const latestCheckRequestRef = useRef(0);
  const activeCheckTokenRef = useRef<number | null>(null);
  const checkQueueRef = useRef<Promise<void>>(Promise.resolve());

  const isCurrentCheck = useCallback((requestId: number) => {
    return mountedRef.current && activeRef.current && latestCheckRequestRef.current === requestId;
  }, []);

  const runCheck = useCallback(async () => {
    const requestId = latestCheckRequestRef.current + 1;
    const checkToken = nextUpdateCheckToken + 1;
    latestCheckRequestRef.current = requestId;
    nextUpdateCheckToken = checkToken;
    activeCheckTokenRef.current = checkToken;
    setStatus("checking");
    setError(null);
    setUpdateInfo(null);
    setProgress(EMPTY_PROGRESS);

    const executeCheck = async () => {
      if (!isCurrentCheck(requestId)) {
        return;
      }

      const startedAt = Date.now();
      const clearStalePendingUpdate = async () => {
        if (!isCurrentCheck(requestId)) {
          await invoke.clearPendingUpdate(checkToken);
          return true;
        }
        return false;
      };

      try {
        await invoke.beginUpdateCheck(checkToken);
        if (!isCurrentCheck(requestId)) {
          return;
        }

        const currentAppInfo = await invoke.appInfo();
        if (!isCurrentCheck(requestId)) {
          return;
        }
        setAppInfo(currentAppInfo);

        const availableUpdate = await invoke.checkForUpdate(checkToken);
        if (await clearStalePendingUpdate()) {
          return;
        }
        const remainingCheckingMs = MIN_CHECKING_STATE_MS - (Date.now() - startedAt);
        if (remainingCheckingMs > 0) {
          await delay(remainingCheckingMs);
        }

        if (await clearStalePendingUpdate()) {
          return;
        }

        if (availableUpdate) {
          setUpdateInfo(availableUpdate);
          setStatus("update-available");
        } else {
          setStatus("up-to-date");
        }
      } catch (rawError) {
        const normalizedError = toIpcError(rawError);
        const remainingCheckingMs = MIN_CHECKING_STATE_MS - (Date.now() - startedAt);
        if (remainingCheckingMs > 0) {
          await delay(remainingCheckingMs);
        }

        if (!isCurrentCheck(requestId)) {
          return;
        }

        setError(normalizedError);
        setStatus("error");
      }
    };

    checkQueueRef.current = checkQueueRef.current.then(executeCheck, executeCheck);
    await checkQueueRef.current;
  }, [isCurrentCheck]);

  useEffect(() => {
    activeRef.current = active;
    if (active) {
      void runCheck();
    } else {
      const checkToken = activeCheckTokenRef.current;
      if (checkToken !== null) {
        void invoke.clearPendingUpdate(checkToken);
      }
    }
  }, [active, runCheck]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const checkToken = activeCheckTokenRef.current;
      if (checkToken !== null) {
        void invoke.clearPendingUpdate(checkToken);
      }
    };
  }, []);

  const handleDownloadAndInstall = useCallback(async () => {
    setStatus("downloading");
    setError(null);
    setProgress(EMPTY_PROGRESS);

    try {
      await invoke.downloadAndInstallUpdate((event) => {
        if (!mountedRef.current || !activeRef.current) {
          return;
        }
        if (event.event === "Started") {
          setProgress({
            downloaded: 0,
            total: event.data.contentLength ?? null,
          });
          return;
        }
        if (event.event === "Progress") {
          setProgress((current) => ({
            downloaded: current.downloaded + event.data.chunkLength,
            total: current.total,
          }));
          return;
        }
        setProgress((current) => ({
          downloaded: current.total ?? current.downloaded,
          total: current.total,
        }));
      });
      if (!mountedRef.current || !activeRef.current) {
        return;
      }
      setStatus("ready-to-restart");
    } catch (rawError) {
      if (!mountedRef.current || !activeRef.current) {
        return;
      }
      setError(toIpcError(rawError));
      setStatus("error");
    }
  }, []);

  const handleRestart = useCallback(async () => {
    try {
      await invoke.relaunchApp();
    } catch (rawError) {
      if (!mountedRef.current || !activeRef.current) {
        return;
      }
      setError(toIpcError(rawError));
      setStatus("error");
    }
  }, []);

  const downloadPercent = useMemo(() => {
    if (!progress.total || progress.total <= 0) return null;
    return Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
  }, [progress.downloaded, progress.total]);

  const currentVersion = appInfo?.version ?? t("updates.unknownVersion");

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {t("updates.title")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("updates.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runCheck()}
          disabled={status === "checking" || status === "downloading"}
          className="btn-secondary shrink-0 px-3 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t("updates.recheck")}
        </button>
      </div>

      <div className="flex items-center justify-between border-t border-border py-3">
        <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          {t("updates.currentVersion")}
        </span>
        <span className="text-sm font-semibold font-mono text-foreground">
          {currentVersion}
        </span>
      </div>

      {status === "checking" && (
        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {t("updates.checking")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("updates.checkingDetail")}
              </p>
            </div>
          </div>
        </div>
      )}

      {status === "up-to-date" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
          <div className="flex items-center gap-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <div>
              <p className="text-sm font-semibold">{t("updates.upToDate")}</p>
              <p className="mt-1 text-xs text-emerald-700">
                {t("updates.upToDateDetail", { version: currentVersion })}
              </p>
            </div>
          </div>
        </div>
      )}

      {status === "update-available" && updateInfo && (
        <>
          <div className="rounded-lg border border-border bg-card p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary shrink-0"
                >
                  <path d="M12 5v14M5 12l7 7 7-7" />
                </svg>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {t("updates.available", { version: updateInfo.version })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("updates.availableDetail", {
                      currentVersion: updateInfo.current_version,
                      version: updateInfo.version,
                    })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleDownloadAndInstall()}
                className="btn-primary shrink-0 px-3 py-1.5 text-xs"
              >
                {t("updates.downloadAndInstall")}
              </button>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {t("updates.releaseNotes")}
            </p>
            {updateInfo.notes ? (
              <MarkdownContent
                content={updateInfo.notes}
                className="bg-background"
                style={{ maxHeight: 130 }}
              />
            ) : (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                {t("updates.noReleaseNotes")}
              </div>
            )}
          </div>
        </>
      )}

      {status === "downloading" && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-semibold text-foreground">
            {t("updates.downloading")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {downloadPercent !== null
              ? t("updates.downloadProgress", { percent: downloadPercent })
              : t("updates.downloadingDetail")}
          </p>
          <div className="mt-4 space-y-2">
            <ProgressBar
              value={downloadPercent ?? 0}
              max={100}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("updates.downloadedBytes", { downloaded: formatBytes(progress.downloaded), total: progress.total ? formatBytes(progress.total) : "?" })}</span>
              <span>{downloadPercent !== null ? `${downloadPercent}%` : "--"}</span>
            </div>
          </div>
        </div>
      )}

      {status === "ready-to-restart" && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sky-950">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                <path d="M21 2v6h-6" />
                <path d="M3 12a9 9 0 0 0 15.55 5.45L21 14" />
                <path d="M3 22v-6h6" />
                <path d="M21 12a9 9 0 0 0-15.55-5.45L3 10" />
              </svg>
              <div>
                <p className="text-sm font-semibold">{t("updates.readyToRestart")}</p>
                <p className="mt-1 text-xs text-sky-800">
                  {t("updates.readyToRestartDetail")}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleRestart()}
              className="btn-primary shrink-0 px-4 py-2"
            >
              {t("updates.restartNow")}
            </button>
          </div>
        </div>
      )}

      {status === "error" && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
          <div className="flex items-start gap-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t("updates.checkFailed")}</p>
              <p className="mt-1 text-xs font-medium text-red-800">{error.code}</p>
              <p className="mt-1 text-xs text-red-700 break-words">{error.message}</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
