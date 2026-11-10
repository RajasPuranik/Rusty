#!/usr/bin/env bash
# Package Rusty Browser as a standalone Linux AppImage
set -euo pipefail

APP_DIR="AppDir"
BUILD_DIR="target/release"

echo "==> Building Rusty Browser release..."
cargo build --release

echo "==> Preparing AppDir structure..."
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/usr/bin"
mkdir -p "$APP_DIR/usr/share/applications"
mkdir -p "$APP_DIR/usr/share/icons/hicolor/256x256/apps"

cp "$BUILD_DIR/rusty_browser" "$APP_DIR/usr/bin/"
cp assets/rusty_browser.desktop "$APP_DIR/usr/share/applications/"
cp assets/rusty_browser.desktop "$APP_DIR/"

# PLACEHOLDER: Generate or copy 256x256 app icon if present
if [ -f "assets/icon.png" ]; then
    cp assets/icon.png "$APP_DIR/usr/share/icons/hicolor/256x256/apps/rusty_browser.png"
    cp assets/icon.png "$APP_DIR/rusty_browser.png"
fi

cat << 'EOF' > "$APP_DIR/AppRun"
#!/bin/sh
HERE="$(dirname "$(readlink -f "${0}")")"
export PATH="${HERE}/usr/bin:${PATH}"
export LD_LIBRARY_PATH="${HERE}/usr/lib:${LD_LIBRARY_PATH:-}"
exec "${HERE}/usr/bin/rusty_browser" "$@"
EOF
chmod +x "$APP_DIR/AppRun"

echo "==> Fetching appimagetool if not available..."
if ! command -v appimagetool &> /dev/null; then
    if [ ! -f "appimagetool" ]; then
        curl -sLO https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage
        chmod +x appimagetool-x86_64.AppImage
        ./appimagetool-x86_64.AppImage "$APP_DIR" "RustyBrowser-x86_64.AppImage"
        exit 0
    fi
fi

appimagetool "$APP_DIR" "RustyBrowser-x86_64.AppImage"
echo "==> AppImage created: RustyBrowser-x86_64.AppImage"
