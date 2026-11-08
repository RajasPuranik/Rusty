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
   - Files: ui/css/newtab.css, ui/newtab.html
   - Purpose: Custom user wallpapers for the new tab page.
   - Status: CSS gradient / procedural canvas background (Constellation / Aurora).
   - How to replace: Set CSS `--ntp-wallpaper-url: url('path/to/image.jpg')`.

5. DISPLAY FONT FOR CLOCK (OPTIONAL)
   - Files: ui/css/newtab.css, ui/newtab.html
   - Purpose: Digital clock typography on the new tab page.
   - Status: System sans-serif variable font with `font-variant-numeric: tabular-nums`.
   - How to replace: Change `--clock-font-family` in `newtab.css` to an imported
     or local monospace/display font.

6. WEATHER WIDGET DATA SOURCE
   - Files: ui/newtab.html, ui/js/newtab.js
   - Purpose: Live weather forecast on the new tab page.
   - Status: Static placeholder widget slot rendering current date and placeholder
     weather chip ("--°C Offline").
   - How to replace: Hook a weather API or native Rust geolocation/weather provider
     into `newtab.js:renderWeatherWidget()`.

================================================================================
