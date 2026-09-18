use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    mpsc,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static NEXT: AtomicUsize = AtomicUsize::new(0);

pub fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/metadata")
}

pub struct Library(pub PathBuf);

impl Library {
    pub fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "maestro-metadata-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(path.join("cache")).unwrap();
        Self(path)
    }

    pub fn copy(&self, name: &str) -> PathBuf {
        let path = self.0.join(name);
        std::fs::copy(fixtures().join(name), &path).unwrap();
        path
    }

    pub fn params(&self, path: &Path) -> Value {
        json!({"path": path, "coverArtCacheDir": self.0.join("cache")})
    }
}

impl Drop for Library {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub struct Engine {
    child: Child,
    input: ChildStdin,
    lines: mpsc::Receiver<String>,
    next_id: usize,
}

impl Engine {
    pub fn new() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_metadata-engine"))
            .arg("--jsonl")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let output = child.stdout.take().unwrap();
        let (sender, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                if sender.send(line.expect("read stdout")).is_err() {
                    break;
                }
            }
        });
        Self {
            child,
            input,
            lines,
            next_id: 0,
        }
    }

    pub fn exchange(&mut self, method: &str, params: Value) -> Vec<Value> {
        self.next_id += 1;
        let id = self.next_id.to_string();
        writeln!(
            self.input,
            "{}",
            json!({"id": id, "method": method, "params": params})
        )
        .unwrap();
        self.input.flush().unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let mut messages = Vec::new();
        loop {
            let line = self
                .lines
                .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
                .expect("engine must respond within ten seconds");
            let message: Value = serde_json::from_str(&line).expect("stdout contains only JSONL");
            let terminal = message["type"] == "response";
            assert_eq!(message[if terminal { "id" } else { "requestId" }], id);
            messages.push(message);
            if terminal {
                return messages;
            }
        }
    }

    pub fn request(&mut self, method: &str, params: Value) -> Value {
        let messages = self.exchange(method, params);
        let response = messages.last().unwrap();
        assert_eq!(response["ok"], true, "{method}: {response}");
        response["result"].clone()
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
