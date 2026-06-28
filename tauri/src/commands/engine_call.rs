use crate::commands::error::AppError;
use crate::sidecar::SidecarManager;

#[tauri::command]
pub async fn engine_call(
    state: tauri::State<'_, SidecarManager>,
    method: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    let response = state.call(&method, params).await.map_err(AppError::Sidecar)?;
    if let Some(error) = response.error {
        return Err(AppError::Engine {
            code: error.code,
            message: error.message,
        });
    }
    Ok(response.result.unwrap_or(serde_json::Value::Null))
}
