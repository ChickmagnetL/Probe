use crate::commands::error::AppError;
use crate::sidecar::SidecarManager;

/// Read the raw JSONL file for a session. Resolves source_path internally
/// by calling `get_session_detail` via the engine, so the frontend cannot
/// pass arbitrary file paths.
#[tauri::command]
pub async fn read_raw_file(
    state: tauri::State<'_, SidecarManager>,
    session_id: String,
) -> Result<String, AppError> {
    // 1. Resolve source_path by calling the existing engine method
    let response = state
        .call(
            "get_session_detail",
            serde_json::json!({ "session_id": session_id }),
        )
        .await
        .map_err(AppError::Sidecar)?;

    if let Some(error) = response.error {
        return Err(AppError::Engine {
            code: error.code,
            message: error.message,
        });
    }

    let detail = response.result.ok_or_else(|| AppError::Engine {
        code: "INTERNAL_ERROR".into(),
        message: "empty response from engine".into(),
    })?;

    // 2. Extract source_path from the session detail
    let source_path = detail
        .get("session")
        .and_then(|s| s.get("source_path"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let source_path = match source_path {
        Some(p) if !p.is_empty() => p,
        _ => {
            return Err(AppError::Engine {
                code: "NOT_FOUND".into(),
                message: "session has no source file".into(),
            });
        }
    };

    // 3. Read the file from disk
    tokio::fs::read_to_string(&source_path)
        .await
        .map_err(|e| AppError::Native(format!("could not read source file: {source_path}: {e}")))
}
