================================================================================
RUSTY BROWSER — UI ASSET & PROVIDER PLACEHOLDERS
================================================================================

This file catalogs all temporary/placeholder assets and swappable data providers
in Rusty Browser. Each item is also tagged inline with a `PLACEHOLDER:` comment
in its source file so you can drop in final artwork or providers cleanly without
altering browser architecture.

1. LOGO
   - File: ui/assets/logo.svg (`<!-- PLACEHOLDER: logo ... -->`)
   - Purpose: Browser chrome branding and new-tab watermark.
   - Status: Generic geometric rounded logo with orange gradient slash (no brand marks).
   - How to replace: Drop any 32x32 to 512x512 SVG or PNG into `ui/assets/logo.svg`.

2. ICON SET
   - File: ui/js/icons.js (`// /* PLACEHOLDER: icon set ... */`)
   - Purpose: Unified inline SVG icon dictionary for navigation, tabs, panels,
     time/weather, pet edit, and media controls.
   - Status: Lightweight 16x16 / 20x20 / 24x24 inline SVG vector paths.
   - How to replace: Modify or replace paths inside `ICONS` while keeping viewBoxes
     consistent (`0 0 24 24` or `0 0 16 16`).

3. 3D EARTH GLOBE TEXTURES & STATIC FALLBACK (A2)
   - Files:
     * ui/assets/earth-day.webp       (27,058 bytes, <= 1024px)
     * ui/assets/earth-night.webp     (16,542 bytes, <= 1024px)
     * ui/assets/earth-fallback.webp  (14,194 bytes, shown when effects=0% or no WebGL)
     * Referenced in: ui/js/globe.js (lines 4-7, 40) & src/ui/app_protocol.rs (line 33)
   - Status: Procedural self-generated equirectangular placeholder WebP textures
     with stylized continents, bathymetry, and night city lights (<= 1024px max).
   - License Notice & How to Replace:
     Before shipping public releases, you may swap in public-domain NASA Blue Marble /
     Black Marble or Natural Earth equirectangular maps (1024x512 WebP recommended)
     and **verify each replaced texture's exact license terms & attribution rules**.

4. COMPANION PET ARTWORK (A3 — CRAZY SKIN ONLY)
   - File: ui/js/pet-crazy.js (`// PLACEHOLDER: Companion pet characters ...`, lines 2 & 71)
   - Purpose: Bottom-of-left-rail (and optional chrome-roam) companion mascot for the
     Crazy skin (never loaded in Minimal skin).
   - Status: 5 ORIGINAL layered geometric SVG characters (`dog`, `cat`, `robot`,
     `fox`, `slime`) with named SVG layer groups (`shadow`, `tail`, `legs`, `torso`,
     `head`, `ears`, `eyes`, `pupils`, `mouth`, `accessory`) and CSS `data-state`
     animation hooks (`idle`, `look`, `follow`, `curious`, `happy`, `play`, `sleep`,
     `feed`, `celebrate`, `loading`, `wave`, `worried`, `yawn`). No copyrighted characters.
   - How to replace: Swap `buildPetSvg(...)` in `ui/js/pet-crazy.js` (keeping the
     `data-layer` groups or pointing CSS states to sprite sheet keyframes).

5. SPEED-DIAL SITE ICONS
   - Files: ui/js/newtab.js, ui/css/newtab.css
   - Purpose: Tiles for bookmarked / quick-access sites.
   - Status: High-contrast letter avatars until an external favicon service is added.
   - How to replace: Supply a `faviconUrl` string in each speed-dial item.

6. WALLPAPERS & CLOCK FONT (OPTIONAL)
   - Files: ui/css/newtab.css, ui/newtab.html
   - Purpose: New Tab Page backdrop and clock typography.
   - Status: Pure CSS layered gradients + system display font (`tabular-nums`).

7. WEATHER DATA PROVIDER (A1) & PRIVACY-PRESERVING LOCATION
   - Files: src/weather.rs (`fetch_from_provider`), ui/js/locations.js
   - Purpose: Current weather + 5-day forecast on the merged Time & Weather card.
   - Status:
     * Swappable Open-Meteo HTTPS client isolated behind `weather::fetch_from_provider`
       in `src/weather.rs` (WinHTTP, 30-minute in-memory & disk cache, offline fallback).
     * Location priority: (1) Settings user-typed city (`weather_location`),
       (2) embedded client timezone/locale centroid (`ui/js/locations.js`, zero network call),
       (3) browser `navigator.geolocation` ONLY on explicit "Use my location" button click.
     * ZERO automatic IP geolocation lookups are ever made.
   - How to replace: Swap the HTTP endpoint & parser strictly inside `fetch_from_provider`
     while keeping `WeatherRequest` and `WeatherData` intact.

================================================================================
