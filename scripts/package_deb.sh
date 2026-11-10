#!/usr/bin/env bash
# Package Rusty Browser as a Debian (.deb) package using cargo-deb
set -euo pipefail

echo "==> Building Rusty Browser release binary..."
cargo build --release

echo "==> Verifying cargo-deb installation..."
if ! command -v cargo-deb &> /dev/null; then
    echo "cargo-deb not found. Installing..."
    cargo install cargo-deb
fi

echo "==> Packaging .deb..."
cargo deb --no-build

echo "==> .deb package built successfully in target/debian/"
