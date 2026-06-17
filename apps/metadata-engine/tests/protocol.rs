//! End-to-end tests for the JSONL-over-stdio protocol, driving the actual
//! compiled `metadata-engine` binary the way the Electron sidecar does:
//! write newline-delimited requests to stdin, then parse the response lines
//! from stdout. Cargo builds the binary automatically and exposes its path via
//! `CARGO_BIN_EXE_metadata-engine`.

use std::io::{BufRead, BufReader, Write};
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

fn run_streaming_request(request: &str, id: &str) -> Vec<Value> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_metadata-engine"))
        .arg("--jsonl")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("failed to spawn metadata-engine");
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let mut reader = BufReader::new(stdout);
    let mut messages = Vec::new();

    writeln!(stdin, "{request}").expect("write request");
    stdin.flush().expect("flush request");

    loop {
        let mut line = String::new();
        reader.read_line(&mut line).expect("read protocol line");
        let message: Value = serde_json::from_str(line.trim()).expect("valid JSONL message");
        let is_terminal = message["type"] == "response" && message["id"] == id;
        messages.push(message);
        if is_terminal {
            break;
        }
    }

    drop(stdin);
    child.wait().expect("worker exit");
    messages
}

fn read_until_response(reader: &mut impl BufRead, id: &str) -> Vec<Value> {
    let mut messages = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).expect("read protocol line");
        let message: Value = serde_json::from_str(line.trim()).expect("valid JSONL message");
        let is_terminal = message["type"] == "response" && message["id"] == id;
        messages.push(message);
        if is_terminal {
            return messages;
        }
    }
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
fn read_file_on_missing_path_reports_file_not_found() {
    let cache_dir = std::env::temp_dir().join(format!("me-test-cache-{}", std::process::id()));
    std::fs::create_dir_all(&cache_dir).expect("create cache dir");
    let missing = cache_dir.join("does-not-exist.flac");

    let request = format!(
        r#"{{"type":"request","id":"r1","method":"read_file","params":{{"path":{path},"coverArtCacheDir":{cache}}}}}"#,
        path = Value::from(missing.to_string_lossy().to_string()),
        cache = Value::from(cache_dir.to_string_lossy().to_string()),
    );
    let responses = run_engine(&[&request]);

    let response = find_by_id(&responses, "r1");
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"]["code"], "FILE_NOT_FOUND");

    let _ = std::fs::remove_dir_all(&cache_dir);
}

#[test]
fn read_file_on_non_audio_path_reports_not_audio_file() {
    let cache_dir = std::env::temp_dir().join(format!("me-test-cache-{}", std::process::id()));
    std::fs::create_dir_all(&cache_dir).expect("create cache dir");
    let text_file = cache_dir.join("notes.txt");
    std::fs::write(&text_file, b"not audio").expect("write text file");

    let request = format!(
        r#"{{"type":"request","id":"r1","method":"read_file","params":{{"path":{path},"coverArtCacheDir":{cache}}}}}"#,
        path = Value::from(text_file.to_string_lossy().to_string()),
        cache = Value::from(cache_dir.to_string_lossy().to_string()),
    );
    let responses = run_engine(&[&request]);

    let response = find_by_id(&responses, "r1");
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"]["code"], "NOT_AN_AUDIO_FILE");

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

#[test]
fn prescan_streams_supported_file_facts_in_requested_batches() {
    let root = std::env::temp_dir().join(format!("me-prescan-{}", std::process::id()));
    std::fs::create_dir_all(&root).expect("create root");
    std::fs::write(root.join("one.flac"), b"one").expect("write audio candidate");
    std::fs::write(root.join("ignored.txt"), b"text").expect("write ignored file");

    let request = format!(
        r#"{{"type":"request","id":"s1","method":"prescan","params":{{"paths":[{root}],"batchSize":1}}}}"#,
        root = Value::from(root.to_string_lossy().to_string()),
    );
    let messages = run_streaming_request(&request, "s1");
    let batches: Vec<&Value> = messages
        .iter()
        .filter(|message| message["event"] == "batch")
        .collect();
    let response = messages.last().expect("terminal response");

    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0]["data"]["items"][0]["fileName"], "one.flac");
    assert_eq!(batches[0]["data"]["items"][0]["size"], 3);
    assert!(batches[0]["data"]["items"][0]["modifiedAt"].is_number());
    assert_eq!(response["result"]["count"], 1);
    assert_eq!(response["result"]["errors"], 0);

    std::fs::remove_dir_all(root).expect("remove root");
}

#[test]
fn prescan_reports_unreadable_roots_instead_of_silently_succeeding() {
    let missing = std::env::temp_dir().join(format!("me-prescan-missing-{}", std::process::id()));
    let request = format!(
        r#"{{"type":"request","id":"s2","method":"prescan","params":{{"paths":[{root}]}}}}"#,
        root = Value::from(missing.to_string_lossy().to_string()),
    );
    let messages = run_streaming_request(&request, "s2");
    let item_error = messages
        .iter()
        .find(|message| message["event"] == "item_error")
        .expect("item error event");
    let response = messages.last().expect("terminal response");

    assert_eq!(
        item_error["data"]["path"],
        missing.to_string_lossy().as_ref()
    );
    assert_eq!(response["result"]["count"], 0);
    assert_eq!(response["result"]["errors"], 1);
}

#[test]
fn read_files_streams_item_errors_and_completes_the_batch() {
    let missing = std::env::temp_dir().join(format!("me-missing-{}.flac", std::process::id()));
    let cache = std::env::temp_dir().join(format!("me-read-cache-{}", std::process::id()));
    let request = format!(
        r#"{{"type":"request","id":"r2","method":"read_files","params":{{"paths":[{path}],"coverArtCacheDir":{cache}}}}}"#,
        path = Value::from(missing.to_string_lossy().to_string()),
        cache = Value::from(cache.to_string_lossy().to_string()),
    );
    let messages = run_streaming_request(&request, "r2");
    let item_error = messages
        .iter()
        .find(|message| message["event"] == "item_error")
        .expect("item error event");
    let response = messages.last().expect("terminal response");

    assert_eq!(
        item_error["data"]["path"],
        missing.to_string_lossy().as_ref()
    );
    assert_eq!(item_error["data"]["code"], "FILE_NOT_FOUND");
    assert_eq!(response["result"]["count"], 0);
    assert_eq!(response["result"]["total"], 1);

    let _ = std::fs::remove_dir_all(cache);
}

#[test]
fn accepts_the_next_batch_immediately_after_a_terminal_response() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_metadata-engine"))
        .arg("--jsonl")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("failed to spawn metadata-engine");
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let mut reader = BufReader::new(stdout);
    let cache = std::env::temp_dir().join(format!("me-sequential-cache-{}", std::process::id()));
    let missing = std::env::temp_dir().join(format!("me-sequential-{}.flac", std::process::id()));

    for id in ["batch-1", "batch-2"] {
        let request = format!(
            r#"{{"type":"request","id":"{id}","method":"read_files","params":{{"paths":[{path}],"coverArtCacheDir":{cache}}}}}"#,
            path = Value::from(missing.to_string_lossy().to_string()),
            cache = Value::from(cache.to_string_lossy().to_string()),
        );
        writeln!(stdin, "{request}").expect("write request");
        stdin.flush().expect("flush request");
        let messages = read_until_response(&mut reader, id);
        let response = messages.last().expect("terminal response");
        assert_eq!(response["ok"], true, "{response:?}");
    }

    drop(stdin);
    child.wait().expect("worker exit");
    let _ = std::fs::remove_dir_all(cache);
}
