use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Child;

#[derive(Debug, Serialize)]
pub struct IpcRequest {
    pub id: String,
    pub method: String,
    pub params: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct IpcResponse {
    pub id: String,
    pub result: Option<serde_json::Value>,
    pub error: Option<IpcError>,
}

#[derive(Debug, Deserialize)]
pub struct IpcError {
    pub code: String,
    pub message: String,
}

pub struct Transport {
    stdin: tokio::process::ChildStdin,
    stdout: BufReader<tokio::process::ChildStdout>,
}

impl Transport {
    pub fn new(child: &mut Child) -> Self {
        let stdin = child.stdin.take().expect("child stdin not piped");
        let stdout = child.stdout.take().expect("child stdout not piped");
        Self {
            stdin,
            stdout: BufReader::new(stdout),
        }
    }

    pub async fn send_request(&mut self, request: &IpcRequest) -> Result<(), String> {
        let json = serde_json::to_string(request).map_err(|e| e.to_string())?;
        self.stdin
            .write_all(json.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        self.stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
        self.stdin.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn read_response(&mut self, expected_id: &str) -> Result<IpcResponse, String> {
        let mut line = String::new();
        let n = self
            .stdout
            .read_line(&mut line)
            .await
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("sidecar closed stdout".to_string());
        }
        let response: IpcResponse =
            serde_json::from_str(&line).map_err(|e| format!("invalid JSON from sidecar: {e}"))?;
        if response.id != expected_id {
            return Err(format!(
                "response id mismatch: expected {expected_id}, got {}",
                response.id
            ));
        }
        Ok(response)
    }
}
