mod commands;
mod sidecar;

use sidecar::SidecarManager;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SidecarManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::engine_call::engine_call,
            commands::file_dialog::open_file_dialog,
            commands::app_state::app_info,
            commands::read_raw_file::read_raw_file,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run application");
}
