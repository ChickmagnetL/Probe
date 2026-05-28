mod commands;
mod sidecar;

use sidecar::SidecarManager;

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
        .run(tauri::generate_context!())
        .expect("failed to run application");
}
