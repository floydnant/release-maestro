//! End-to-end tests for the JSONL-over-stdio protocol, driving the actual
//! compiled `metadata-engine` binary the way the Electron sidecar does:
//! write newline-delimited requests to stdin, then parse the response lines
//! from stdout. Cargo builds the binary automatically and exposes its path via
//! `CARGO_BIN_EXE_metadata-engine`.

use std::io::Write;
use std::process::{Command, Stdio};

use serde_json::Value;

/// Spawns the engine, feeds it `requests` (one per line), closes stdin so the
/// worker drains and exits, and returns every parsed `response` line keyed by id.
/// The malformed-request response (which has an empty id) is keyed by `""`.
fn run_engine(requests: &[&str]) -> Vec<Value> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_metadata-engine"))
        .arg("--jsonl")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("failed to spawn metadata-engine");

    {
        let mut stdin = child.stdin.take().expect("stdin");
        for request in requests {
            writeln!(stdin, "{request}").expect("write request");
        }
        // Dropping stdin signals EOF; the engine exits its read loop.
    }

    let output = child.wait_with_output().expect("wait for engine");
    let stdout = String::from_utf8(output.stdout).expect("utf8 stdout");

    stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str::<Value>(line).expect("response line is valid JSON"))
        .filter(|message| message["type"] == "response")
        .collect()
}

fn find_by_id<'a>(responses: &'a [Value], id: &str) -> &'a Value {
    responses
        .iter()
        .find(|response| response["id"] == id)
        .unwrap_or_else(|| panic!("no response with id {id:?} in {responses:?}"))
}

#[test]
fn ping_reports_protocol_and_engine_version() {
    let responses = run_engine(&[r#"{"type":"request","id":"p1","method":"ping","params":{}}"#]);

    let ping = find_by_id(&responses, "p1");
    assert_eq!(ping["ok"], true);
    assert_eq!(ping["result"]["protocolVersion"], 1);
    assert!(
        ping["result"]["engineVersion"].is_string(),
        "engineVersion should be a string, got {ping:?}"
    );
}

#[test]
fn unknown_method_is_rejected() {
    let responses =
        run_engine(&[r#"{"type":"request","id":"u1","method":"frobnicate","params":{}}"#]);

    let response = find_by_id(&responses, "u1");
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"]["code"], "UNKNOWN_METHOD");
}

#[test]
fn malformed_json_yields_invalid_request() {
    let responses = run_engine(&["{ this is not valid json"]);

    // Malformed input has no parseable id, so the engine replies with an empty id.
    let response = find_by_id(&responses, "");
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"]["code"], "INVALID_REQUEST");
}

#[test]
fn read_file_on_missing_path_resolves_to_null() {
    let cache_dir = std::env::temp_dir().join(format!("me-test-cache-{}", std::process::id()));
    std::fs::create_dir_all(&cache_dir).expect("create cache dir");
    let missing = cache_dir.join("does-not-exist.flac");

    let request = format!(
        r#"{{"type":"request","id":"r1","method":"read_file","params":{{"path":{path},"coverArtCacheDir":{cache}}}}}"#,
        path = Value::from(missing.to_string_lossy().to_string()),
        cache = Value::from(cache_dir.to_string_lossy().to_string()),
    );
    let responses = run_engine(&[&request]);

    // Contract: an unreadable / unsupported file is `null`, not an error.
    let response = find_by_id(&responses, "r1");
    assert_eq!(response["ok"], true);
    assert!(
        response["result"].is_null(),
        "expected null result, got {response:?}"
    );

    let _ = std::fs::remove_dir_all(&cache_dir);
}

#[test]
fn cancel_for_unknown_operation_reports_not_cancelled() {
    let responses = run_engine(&[
        r#"{"type":"request","id":"c1","method":"cancel","params":{"requestId":"nope"}}"#,
    ]);

    let response = find_by_id(&responses, "c1");
    assert_eq!(response["ok"], true);
    assert_eq!(response["result"]["cancelled"], false);
}

#[test]
fn processes_multiple_requests_in_order_on_one_connection() {
    let responses = run_engine(&[
        r#"{"type":"request","id":"a","method":"ping","params":{}}"#,
        r#"{"type":"request","id":"b","method":"ping","params":{}}"#,
    ]);

    assert_eq!(find_by_id(&responses, "a")["ok"], true);
    assert_eq!(find_by_id(&responses, "b")["ok"], true);
}
