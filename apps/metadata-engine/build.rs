use std::fs;
use std::path::{Path, PathBuf};

// Fingerprint the worker source and locked dependencies so any extractor change
// causes a re-read without relying on a manual version bump.
fn main() {
    let mut files = Vec::new();
    collect_rs_files(Path::new("src"), &mut files);
    files.extend([PathBuf::from("Cargo.toml"), PathBuf::from("Cargo.lock")]);
    files.sort();

    let mut hash = 0xcbf29ce484222325_u64;
    for path in files {
        println!("cargo:rerun-if-changed={}", path.display());
        for byte in path.to_string_lossy().bytes().chain([0]) {
            hash = (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3);
        }
        for byte in fs::read(&path).expect("read extractor input") {
            hash = (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3);
        }
    }
    println!("cargo:rustc-env=EXTRACTOR_VERSION={hash:016x}");
}

fn collect_rs_files(directory: &Path, files: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(directory).expect("read extractor source") {
        let path = entry.expect("read source entry").path();
        if path.is_dir() {
            collect_rs_files(&path, files);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            files.push(path);
        }
    }
}
