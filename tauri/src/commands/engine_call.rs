use crate::sidecar::SidecarManager;

#[tauri::command]
pub async fn engine_call(
    state: tauri::State<'_, SidecarManager>,
    method: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let response = state.call(&method, params).await?;
    if let Some(error) = response.error {
        return Err(format!("[{}] {}", error.code, error.message));
    }
    Ok(response.result.unwrap_or(serde_json::Value::Null))
}
