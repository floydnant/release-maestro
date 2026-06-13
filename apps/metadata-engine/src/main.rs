//! `metadata-engine` — a JSON Lines over stdio worker that wraps the Rust/Lofty
//! music-metadata engine for the Release Maestro Electron app.
//!
//! Transport:
//! - stdin:  one `request` JSON object per line
//! - stdout: one `response` / `event` JSON object per line (protocol messages ONLY)
//! - stderr: human/diagnostic logs ONLY
//!
//! Runtime model (v1): one active operation at a time. A second operation while
//! one is running is rejected with a structured `BUSY` error. `cancel` is the
//! only request honoured while an operation is active. Request ids are always
//! required so events can be correlated and operations cancelled.

mod constants;
mod image_format;
mod metadata;
mod protocol;

use metadata::{read_song_metadata_v2, update_song_metadata, SongMetadataUpdateable};
use protocol::{classify_engine_error, ErrorCode, Event, Request, Response, PROTOCOL_VERSION};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    for arg in &args {
        match arg.as_str() {
            "--help" | "-h" => return print_help(),
            "--version" | "-V" => {
                println!("metadata-engine {ENGINE_VERSION} (protocol {PROTOCOL_VERSION})");
                return;
            }
            // Accepted no-op flags. The worker always speaks JSONL over stdio.
            "--jsonl" => {}
            other if other.starts_with("--log-level") => {}
            other => eprintln!("Ignoring unknown argument: {other}"),
        }
    }

    run_loop();
}

fn print_help() {
    println!(
        "metadata-engine {ENGINE_VERSION}\n\n\
         A JSON Lines over stdio music-metadata worker.\n\n\
         USAGE:\n    metadata-engine [--jsonl] [--log-level <level>]\n\n\
         FLAGS:\n    -h, --help       Print this help\n    -V, --version    Print version\n        --jsonl      Speak JSONL over stdio (default)\n\n\
         Send one JSON request object per line on stdin. Responses and events are\n\
         written one JSON object per line on stdout. Methods: ping, read_file, scan,\n\
         write_tags, cancel."
    );
}

/// Thread-safe writer for the single stdout protocol stream. Cloned into scan
/// worker threads so event/response lines never interleave.
#[derive(Clone)]
struct Emitter {
    out: Arc<Mutex<std::io::Stdout>>,
}

impl Emitter {
    fn new() -> Self {
        Emitter {
            out: Arc::new(Mutex::new(std::io::stdout())),
        }
    }

    fn write_line(&self, value: &impl serde::Serialize) {
        let line = match serde_json::to_string(value) {
            Ok(line) => line,
            Err(error) => {
                eprintln!("Failed to serialize protocol message: {error}");
                return;
            }
        };
        let mut out = self.out.lock().unwrap();
        if writeln!(out, "{line}").is_err() {
            return;
        }
        let _ = out.flush();
    }

    fn response(&self, response: Response) {
        self.write_line(&response);
    }

    fn event(&self, request_id: &str, event: &str, data: Value) {
        self.write_line(&Event::new(request_id.to_string(), event, data));
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadFileParams {
    path: String,
    cover_art_cache_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanParams {
    paths: Vec<String>,
    cover_art_cache_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteTagsParams {
    path: String,
    update: SongMetadataUpdateable,
    cover_art_cache_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelParams {
    request_id: String,
}

/// A scan currently running on a worker thread.
struct ActiveOp {
    id: String,
    cancel: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

fn run_loop() {
    let emitter = Emitter::new();
    let stdin = std::io::stdin();
    let mut active: Option<ActiveOp> = None;

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                eprintln!("stdin read error: {error}");
                break;
            }
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let request: Request = match serde_json::from_str(trimmed) {
            Ok(request) => request,
            Err(error) => {
                emitter.response(Response::err(
                    String::new(),
                    ErrorCode::InvalidRequest.error(format!("Malformed request JSON: {error}")),
                ));
                continue;
            }
        };

        // Reap a finished scan so a new operation isn't wrongly rejected as BUSY.
        if active.as_ref().is_some_and(|op| op.handle.is_finished()) {
            if let Some(op) = active.take() {
                let _ = op.handle.join();
            }
        }

        match request.method.as_str() {
            // Always honoured, even while an operation is active.
            "cancel" => handle_cancel(&emitter, &request, &active),
            "ping" => handle_ping(&emitter, &request),
            other => {
                if active.is_some() {
                    emitter.response(Response::err(
                        request.id,
                        ErrorCode::Busy.error("Another operation is already in progress"),
                    ));
                    continue;
                }
                match other {
                    "read_file" => handle_read_file(&emitter, request),
                    "write_tags" => handle_write_tags(&emitter, request),
                    "scan" => {
                        if let Some(op) = start_scan(emitter.clone(), request) {
                            active = Some(op);
                        }
                    }
                    _ => emitter.response(Response::err(
                        request.id,
                        ErrorCode::UnknownMethod.error(format!("Unknown method '{other}'")),
                    )),
                }
            }
        }
    }

    // stdin closed: cancel and drain any in-flight scan before exiting.
    if let Some(op) = active.take() {
        op.cancel.store(true, Ordering::SeqCst);
        let _ = op.handle.join();
    }
}

fn handle_ping(emitter: &Emitter, request: &Request) {
    emitter.response(Response::ok(
        request.id.clone(),
        json!({ "protocolVersion": PROTOCOL_VERSION, "engineVersion": ENGINE_VERSION }),
    ));
}

fn handle_cancel(emitter: &Emitter, request: &Request, active: &Option<ActiveOp>) {
    let params: CancelParams = match serde_json::from_value(request.params.clone()) {
        Ok(params) => params,
        Err(error) => {
            return emitter.response(Response::err(
                request.id.clone(),
                ErrorCode::InvalidRequest.error(format!("Invalid cancel params: {error}")),
            ));
        }
    };

    let cancelled = match active {
        Some(op) if op.id == params.request_id => {
            op.cancel.store(true, Ordering::SeqCst);
            true
        }
        _ => false,
    };
    emitter.response(Response::ok(
        request.id.clone(),
        json!({ "cancelled": cancelled }),
    ));
}

fn handle_read_file(emitter: &Emitter, request: Request) {
    let params: ReadFileParams = match serde_json::from_value(request.params) {
        Ok(params) => params,
        Err(error) => {
            return emitter.response(Response::err(
                request.id,
                ErrorCode::InvalidRequest.error(format!("Invalid read_file params: {error}")),
            ));
        }
    };
    ensure_cache_dir(&params.cover_art_cache_dir);

    // `None` preserves the Tauri `get_song_metadata` contract: a non-audio,
    // unsupported, or unreadable file resolves to `null` rather than an error.
    match read_song_metadata_v2(Path::new(&params.path), params.cover_art_cache_dir) {
        Some(song) => match serde_json::to_value(&song) {
            Ok(value) => emitter.response(Response::ok(request.id, value)),
            Err(error) => emitter.response(Response::err(
                request.id,
                ErrorCode::Internal.error(format!("Failed to serialize metadata: {error}")),
            )),
        },
        None => emitter.response(Response::ok(request.id, Value::Null)),
    }
}

fn handle_write_tags(emitter: &Emitter, request: Request) {
    let params: WriteTagsParams = match serde_json::from_value(request.params) {
        Ok(params) => params,
        Err(error) => {
            return emitter.response(Response::err(
                request.id,
                ErrorCode::InvalidRequest.error(format!("Invalid write_tags params: {error}")),
            ));
        }
    };
    ensure_cache_dir(&params.cover_art_cache_dir);

    match update_song_metadata(&params.path, params.update, params.cover_art_cache_dir) {
        Ok(song) => match serde_json::to_value(&song) {
            Ok(value) => emitter.response(Response::ok(request.id, value)),
            Err(error) => emitter.response(Response::err(
                request.id,
                ErrorCode::Internal.error(format!("Failed to serialize metadata: {error}")),
            )),
        },
        Err(message) => {
            emitter.response(Response::err(request.id, classify_engine_error(&message)))
        }
    }
}

fn start_scan(emitter: Emitter, request: Request) -> Option<ActiveOp> {
    let params: ScanParams = match serde_json::from_value(request.params) {
        Ok(params) => params,
        Err(error) => {
            emitter.response(Response::err(
                request.id,
                ErrorCode::InvalidRequest.error(format!("Invalid scan params: {error}")),
            ));
            return None;
        }
    };

    let cancel = Arc::new(AtomicBool::new(false));
    let id = request.id.clone();
    let thread_cancel = cancel.clone();
    let handle = std::thread::spawn(move || run_scan(emitter, request.id, params, thread_cancel));

    Some(ActiveOp { id, cancel, handle })
}

fn run_scan(emitter: Emitter, id: String, params: ScanParams, cancel: Arc<AtomicBool>) {
    ensure_cache_dir(&params.cover_art_cache_dir);

    // Collect the file list up front so progress events can report a total.
    let mut files: Vec<PathBuf> = Vec::new();
    for root in &params.paths {
        collect_files(Path::new(root), &mut files);
    }
    let total = files.len();
    emitter.event(&id, "started", json!({ "total": total }));

    let mut count = 0usize;
    let mut done = 0usize;
    for file in files {
        if cancel.load(Ordering::SeqCst) {
            return emitter.response(Response::err(
                id,
                ErrorCode::Cancelled.error("Scan cancelled"),
            ));
        }

        done += 1;
        match read_song_metadata_v2(&file, params.cover_art_cache_dir.clone()) {
            Some(song) => match serde_json::to_value(&song) {
                Ok(value) => {
                    count += 1;
                    emitter.event(&id, "item", json!({ "metadata": value }));
                }
                Err(error) => emitter.event(
                    &id,
                    "item_error",
                    json!({ "path": file.to_string_lossy(), "error": error.to_string() }),
                ),
            },
            // Non-audio / unreadable files are skipped, matching the Tauri
            // `get_songs` behaviour which silently drops `None` results.
            None => {}
        }
        emitter.event(&id, "progress", json!({ "done": done, "total": total }));
    }

    emitter.response(Response::ok(id, json!({ "count": count, "total": total })));
}

/// Recursively collect every file (not directory) under `path`.
fn collect_files(path: &Path, out: &mut Vec<PathBuf>) {
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return,
    };

    if metadata.is_dir() {
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                collect_files(&entry.path(), out);
            }
        }
    } else {
        out.push(path.to_path_buf());
    }
}

fn ensure_cache_dir(dir: &str) {
    if let Err(error) = std::fs::create_dir_all(dir) {
        eprintln!("Failed to create cover art cache dir '{dir}': {error}");
    }
}
