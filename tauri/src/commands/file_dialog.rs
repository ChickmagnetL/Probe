use crate::commands::error::AppError;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn open_file_dialog(
    app: tauri::AppHandle,
    title: Option<String>,
    directory: Option<bool>,
) -> Result<Option<String>, AppError> {
    let mut builder = app.dialog().file();
    if let Some(t) = title {
        builder = builder.set_title(&t);
    }

    // Native file dialogs are intentionally blocking system calls.
    let result = if directory.unwrap_or(false) {
        builder.blocking_pick_folder().map(|p| p.to_string())
    } else {
        builder.blocking_pick_file().map(|p| p.to_string())
    };

    Ok(result)
}
