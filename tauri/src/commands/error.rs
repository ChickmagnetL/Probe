use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "data")]
pub enum AppError {
    /// Pass-through of a structured error from the Python engine.
    #[error("engine error [{code}]: {message}")]
    Engine {
        code: String,
        message: String,
    },

    /// Sidecar lifecycle / transport failure.
    #[error("sidecar error: {0}")]
    Sidecar(String),

    /// Native integration failure (file I/O, dialog, etc.).
    #[error("native error: {0}")]
    Native(String),
}
