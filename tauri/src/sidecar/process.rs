use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use super::transport::{IpcRequest, IpcResponse, Transport};

pub struct SidecarManager {
    inner: Mutex<Option<SidecarInner>>,
    seq: AtomicU64,
}

struct SidecarInner {
    transport: Transport,
    _child: Child,
}

impl Drop for SidecarInner {
    fn drop(&mut self) {
        let _ = self._child.start_kill();
    }
}

/// Returns true if running inside a macOS .app bundle.
fn is_bundled() -> bool {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(s) = exe.to_str() {
            return s.contains(".app/Contents/MacOS/");
        }
    }
    false
}

/// Resolve the sidecar binary path for both bundled and dev modes.
///
/// Bundled: `<binary_dir>/probe-engine` (Tauri places externalBin in Contents/MacOS/)
/// Dev:     `<manifest_dir>/../engine/dist/probe-engine`
fn sidecar_path() -> PathBuf {
    if is_bundled() {
        // Bundled mode: Tauri places externalBin binaries next to the main
        // executable in Contents/MacOS/.
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                let path = parent.join("probe-engine");
                if path.exists() {
                    return path;
                }
            }
        }
    }

    // Dev mode (or fallback): sidecar is built alongside engine/
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .expect("app/ directory")
        .join("engine/dist/probe-engine")
}

/// Resolve the engine directory for both bundled and dev modes.
///
/// Bundled: home directory (PyInstaller binary resolves DB path internally)
/// Dev:     `<manifest_dir>/../engine`
fn engine_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("TAURI_ENGINE_PATH") {
        return PathBuf::from(custom);
    }

    if is_bundled() {
        // The bundled sidecar is a self-contained PyInstaller binary.
        // It resolves its database path from platform conventions, not cwd.
        // Use home directory as a safe working directory.
        return std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/"));
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("app/ directory")
        .join("engine")
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            seq: AtomicU64::new(0),
        }
    }

    pub async fn start(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().await;
        if guard.is_some() {
            return Ok(());
        }

        let engine = engine_dir();
        let sidecar = sidecar_path();

        let mut child = if sidecar.exists() {
            // Bundled mode: use the PyInstaller standalone binary.
            Command::new(&sidecar)
                .current_dir(&engine)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .map_err(|e| format!("failed to spawn sidecar: {e}"))?
        } else {
            // Dev mode: fall back to python3 + server.py
            let python = find_python();
            let server_py = engine.join("server.py");

            if !server_py.exists() {
                return Err(format!("server.py not found at {}", server_py.display()));
            }

            Command::new(&python)
                .arg(&server_py)
                .current_dir(&engine)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .map_err(|e| format!("failed to spawn python: {e}"))?
        };

        let transport = Transport::new(&mut child);

        *guard = Some(SidecarInner {
            transport,
            _child: child,
        });

        eprintln!("[sidecar] started process");
        Ok(())
    }

    pub async fn call(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<IpcResponse, String> {
        {
            let guard = self.inner.lock().await;
            if guard.is_none() {
                drop(guard);
                self.start().await?;
            }
        }

        let id = format!("req-{}", self.seq.fetch_add(1, Ordering::Relaxed));
        let request = IpcRequest {
            id: id.clone(),
            method: method.to_string(),
            params,
        };

        let mut guard = self.inner.lock().await;
        let inner = guard.as_mut().ok_or("sidecar not running")?;
        inner
            .transport
            .send_request(&request)
            .await
            .map_err(|e| format!("send failed: {e}"))?;

        let response = inner
            .transport
            .read_response(&request.id)
            .await
            .map_err(|e| format!("read failed: {e}"))?;

        Ok(response)
    }

    #[allow(dead_code)]
    pub async fn stop(&self) {
        let mut guard = self.inner.lock().await;
        if let Some(mut inner) = guard.take() {
            let _ = inner._child.kill().await;
            eprintln!("[sidecar] stopped process");
        }
    }
}

fn find_python() -> String {
    if let Ok(custom) = std::env::var("TAURI_PYTHON_PATH") {
        return custom;
    }
    for name in ["python3", "python"] {
        if std::process::Command::new(name)
            .arg("--version")
            .output()
            .is_ok()
        {
            return name.to_string();
        }
    }
    "python3".to_string()
}
