import type {
  ImportResult,
  ListSessionsParams,
  ListSessionsResult,
  SessionDetail,
} from "./types";

type InvokeFn = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let _invoke: InvokeFn | null = null;

async function getInvoke(): Promise<InvokeFn> {
  if (_invoke) return _invoke;

  if (window.__TAURI_INTERNALS__) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    _invoke = tauriInvoke;
  } else {
    const { mockInvoke } = await import("../dev-mock");
    _invoke = mockInvoke;
  }
  return _invoke;
}

export const invoke = {
  async importFiles(inputPath: string): Promise<ImportResult> {
    const fn = await getInvoke();
    return fn<ImportResult>("engine_call", {
      method: "import_files",
      params: { input_path: inputPath },
    });
  },

  async listSessions(params?: ListSessionsParams): Promise<ListSessionsResult> {
    const fn = await getInvoke();
    return fn<ListSessionsResult>("engine_call", {
      method: "list_sessions",
      params: params ?? {},
    });
  },

  async getSessionDetail(sessionId: string): Promise<SessionDetail> {
    const fn = await getInvoke();
    return fn<SessionDetail>("engine_call", {
      method: "get_session_detail",
      params: { session_id: sessionId },
    });
  },

  async openFileDialog(opts?: {
    title?: string;
    directory?: boolean;
  }): Promise<string | null> {
    const fn = await getInvoke();
    return fn<string | null>("open_file_dialog", {
      title: opts?.title ?? null,
      directory: opts?.directory ?? false,
    });
  },

  async deleteSessions(
    sessionIds: string[],
    deleteFiles?: boolean,
  ): Promise<{ deleted_sessions: number; deleted_files: number }> {
    const fn = await getInvoke();
    return fn("engine_call", {
      method: "delete_sessions",
      params: { session_ids: sessionIds, delete_files: deleteFiles ?? false },
    });
  },

  async callEngine<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const fn = await getInvoke();
    return fn<T>("engine_call", { method, params });
  },
};
