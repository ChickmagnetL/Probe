import type { IpcError } from "./types";

function stringifyErrorData(data: unknown): string {
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data) ?? "Unknown error";
  } catch {
    return "Unknown error";
  }
}

/** Narrow an unknown caught value into the cross-layer IpcError shape. */
export function toIpcError(raw: unknown): IpcError {
  if (typeof raw === "object" && raw !== null && "kind" in raw) {
    const record = raw as { kind: string; data: unknown };
    if (record.kind === "Engine" && typeof record.data === "object" && record.data !== null) {
      const data = record.data as { code: string; message: string };
      return { code: data.code, message: data.message };
    }
    return {
      code: record.kind.toUpperCase(),
      message: stringifyErrorData(record.data),
    };
  }
  if (raw instanceof Error) return { code: "INTERNAL_ERROR", message: raw.message };
  return { code: "INTERNAL_ERROR", message: String(raw) };
}
