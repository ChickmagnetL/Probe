use crate::commands::error::AppError;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_dialog::FilePath;

fn local_file_path_to_string(path: FilePath) -> Result<String, AppError> {
    path.into_path()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|url| AppError::Native(format!("dialog returned a non-local path: {url}")))
}

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
        builder
            .blocking_pick_folder()
            .map(local_file_path_to_string)
            .transpose()?
    } else {
        builder
            .blocking_pick_file()
            .map(local_file_path_to_string)
            .transpose()?
    };

    Ok(result)
}
