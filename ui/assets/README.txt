================================================================================
RUSTY BROWSER — UI ASSET PLACEHOLDERS
================================================================================

This file lists all temporary/placeholder assets across the UI layer that can be
swapped out by hand without altering application logic. Each placeholder is also
tagged with a inline /* PLACEHOLDER: <name> */ or <!-- PLACEHOLDER: <name> -->
comment in its respective source file.

1. LOGO
   - File: ui/assets/logo.svg
   - Purpose: Browser chrome branding and new-tab watermark.
   - Status: Generic geometric gradient rounded square (no real brand marks).
   - How to replace: Drop any 32x32 to 512x512 SVG or PNG into this location.

2. ICON SET
   - File: ui/js/icons.js
   - Purpose: Unified inline SVG icon dictionary for navigation, tabs, panels,
     actions, and media controls.
   - Status: Lightweight 16x16 / 20x20 inline SVG vector paths.
   - How to replace: Modify or replace the path definitions inside the `ICONS`
     object. Keep viewBoxes consistent (default `0 0 24 24` or `0 0 16 16`).

3. SPEED-DIAL SITE ICONS
   - Files: ui/js/newtab.js, ui/css/newtab.css
   - Purpose: Favicons/tiles for top visited and custom bookmarked sites.
   - Status: Letter avatars with high-contrast pastel gradients until Rust or an
     external favicon cache service provides cached `favicon.ico` data URLs.
   - How to replace: Supply a `faviconUrl` string in the speed-dial entry object.

4. WALLPAPERS (OPTIONAL)
   - Files: ui/css/newtab.css
   - Purpose: Ambient background for the Crazy skin new tab page.
   - Status: Pure CSS layered radial nebula gradient driven by theme accent variables
     (no bitmap wallpaper shipped by default so widgets stay sharp and overlap-free).
   - How to replace: Add a background rule under `[data-skin="crazy"] body.ntp-body` in
     `ui/css/newtab.css` if you wish to attach a custom photo wallpaper.

5. DISPLAY FONT FOR CLOCK (OPTIONAL)
   - Files: ui/css/newtab.css, ui/newtab.html
   - Purpose: Digital clock typography on the new tab page.
   - Status: System sans-serif variable font with `font-variant-numeric: tabular-nums`.
   - How to replace: Change `--clock-font-family` in `newtab.css` to an imported
     or local monospace/display font.

6. WEATHER WIDGET DATA SOURCE
   - Files: src/weather.rs, ui/newtab.html, ui/js/newtab.js
   - Purpose: Live weather forecast on the new tab page.
   - Status: Rust-fetched live Open-Meteo + geojs.io provider via WinHTTP (falls back
     gracefully to cached weather or "Offline" when disconnected).
   - How to replace: Modify `src/weather.rs` to point to a different weather provider.

================================================================================
