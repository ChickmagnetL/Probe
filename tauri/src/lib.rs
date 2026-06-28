mod commands;
mod sidecar;

use sidecar::SidecarManager;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(SidecarManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::engine_call::engine_call,
            commands::file_dialog::open_file_dialog,
            commands::app_state::app_info,
            commands::read_raw_file::read_raw_file,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

            if let Some(window) = app.get_webview_window("main") {
                // Delay focus to ensure window is fully initialized on macOS
                let window_clone = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    let _ = window_clone.set_focus();
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run application");
}
