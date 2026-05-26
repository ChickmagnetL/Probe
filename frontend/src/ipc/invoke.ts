import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  ImportResult,
  ListSessionsParams,
  ListSessionsResult,
  SessionDetail,
} from "./types";

export const invoke = {
  importFiles(inputPath: string): Promise<ImportResult> {
    return tauriInvoke<ImportResult>("engine_call", {
      method: "import_files",
      params: { input_path: inputPath },
    });
  },

  listSessions(params?: ListSessionsParams): Promise<ListSessionsResult> {
    return tauriInvoke<ListSessionsResult>("engine_call", {
      method: "list_sessions",
      params: params ?? {},
    });
  },

  getSessionDetail(sessionId: string): Promise<SessionDetail> {
    return tauriInvoke<SessionDetail>("engine_call", {
      method: "get_session_detail",
      params: { session_id: sessionId },
    });
  },

  openFileDialog(opts?: {
    title?: string;
    directory?: boolean;
  }): Promise<string | null> {
    return tauriInvoke<string | null>("open_file_dialog", {
      title: opts?.title ?? null,
      directory: opts?.directory ?? false,
    });
  },

  deleteSessions(
    sessionIds: string[],
    deleteFiles?: boolean,
  ): Promise<{ deleted_sessions: number; deleted_files: number }> {
    return tauriInvoke("engine_call", {
      method: "delete_sessions",
      params: { session_ids: sessionIds, delete_files: deleteFiles ?? false },
    });
  },

  callEngine<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    return tauriInvoke<T>("engine_call", { method, params });
  },
};
