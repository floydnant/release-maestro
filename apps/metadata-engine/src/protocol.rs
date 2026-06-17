//! JSONL-over-stdio protocol envelope types and structured error codes.
//!
//! Wire format: one compact JSON object per line.
//! - stdin carries `request` envelopes
//! - stdout carries `response` and `event` envelopes (protocol messages ONLY)
//! - stderr carries human/diagnostic logs ONLY
//!
//! Invariants:
//! - exactly one terminal `response` per `request`
//! - zero or more `event`s may precede the terminal `response`

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Bump when the wire contract changes in a backwards-incompatible way.
pub const PROTOCOL_VERSION: u32 = 1;

/// Inbound request envelope. `type` is accepted but not required for dispatch.
#[derive(Debug, Deserialize)]
pub struct Request {
    pub id: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

/// Structured error returned on the terminal response of a failed request.
#[derive(Debug, Clone, Serialize)]
pub struct ProtocolError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

/// Terminal response envelope (`type: "response"`).
#[derive(Debug, Serialize)]
pub struct Response {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ProtocolError>,
}

impl Response {
    pub fn ok(id: String, result: Value) -> Self {
        Response {
            kind: "response",
            id,
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn err(id: String, error: ProtocolError) -> Self {
        Response {
            kind: "response",
            id,
            ok: false,
            result: None,
            error: Some(error),
        }
    }
}

/// Progress / streaming event envelope (`type: "event"`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub request_id: String,
    pub event: String,
    pub data: Value,
}

impl Event {
    pub fn new(request_id: String, event: &str, data: Value) -> Self {
        Event {
            kind: "event",
            request_id,
            event: event.to_string(),
            data,
        }
    }
}

/// Stable, machine-readable error codes shared with the Electron side.
/// Some variants describe contract surface the engine does not emit yet
/// (e.g. dedicated FILE_NOT_FOUND / ARTWORK_CACHE_FAILED classification).
#[allow(dead_code)]
#[derive(Debug, Clone, Copy)]
pub enum ErrorCode {
    InvalidRequest,
    UnknownMethod,
    Busy,
    FileNotFound,
    UnsupportedFormat,
    NotAnAudioFile,
    ParseFailed,
    WriteFailed,
    ArtworkCacheFailed,
    Cancelled,
    Internal,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::InvalidRequest => "INVALID_REQUEST",
            ErrorCode::UnknownMethod => "UNKNOWN_METHOD",
            ErrorCode::Busy => "BUSY",
            ErrorCode::FileNotFound => "FILE_NOT_FOUND",
            ErrorCode::UnsupportedFormat => "UNSUPPORTED_FORMAT",
            ErrorCode::NotAnAudioFile => "NOT_AN_AUDIO_FILE",
            ErrorCode::ParseFailed => "PARSE_FAILED",
            ErrorCode::WriteFailed => "WRITE_FAILED",
            ErrorCode::ArtworkCacheFailed => "ARTWORK_CACHE_FAILED",
            ErrorCode::Cancelled => "CANCELLED",
            ErrorCode::Internal => "INTERNAL_ERROR",
        }
    }

    pub fn error(self, message: impl Into<String>) -> ProtocolError {
        ProtocolError {
            code: self.as_str().to_string(),
            message: message.into(),
            details: None,
        }
    }
}

/// Best-effort mapping of the engine's legacy `String` errors to structured codes.
/// The original message is always preserved verbatim in `message`.
pub fn classify_engine_error(message: &str) -> ProtocolError {
    let lower = message.to_ascii_lowercase();
    let code = if lower.contains("unsupported file type") {
        ErrorCode::UnsupportedFormat
    } else if lower.contains("rename")
        || lower.contains("save")
        || lower.contains("file name cannot be empty")
    {
        ErrorCode::WriteFailed
    } else if lower.contains("failed to read file") || lower.contains("reload updated metadata") {
        ErrorCode::ParseFailed
    } else {
        ErrorCode::Internal
    };
    code.error(message.to_string())
}
