//! Build script for Rusty Browser.
//!
//! On Windows, ensures `WebView2Loader.dll` is automatically copied alongside
//! the compiled executable in `target/debug/` and `target/release/`.

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    #[cfg(target_os = "windows")]
    copy_webview2_loader();
}

#[cfg(target_os = "windows")]
fn copy_webview2_loader() {
    println!("cargo:rerun-if-changed=WebView2Loader.dll");

    let out_dir = match env::var("OUT_DIR") {
        Ok(dir) => PathBuf::from(dir),
        Err(_) => return,
    };

    // OUT_DIR is: target/{profile}/build/{crate-hash}/out
    // Ancestor 3 is: target/{profile}/
    let target_profile_dir = match out_dir.ancestors().nth(3) {
        Some(dir) => dir.to_path_buf(),
        None => return,
    };

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into()));

    let candidates = [
        manifest_dir.join("WebView2Loader.dll"),
        manifest_dir.join("dist").join("WebView2Loader.dll"),
    ];

    for src in &candidates {
        if src.exists() {
            let dest = target_profile_dir.join("WebView2Loader.dll");
            let _ = fs::copy(src, &dest);
            break;
        }
    }
}
