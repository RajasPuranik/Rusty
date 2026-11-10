const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

test('Milestone R5: Visual Skins (Softer Dark & Mayank White) Suite', async (t) => {
  await t.test('Feature: Softer Dark Skin Refinement', () => {
    const crazyCss = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'css', 'skin-crazy.css'), 'utf8');

    // Neon / cyan / magenta bloom eliminated
    assert.ok(!crazyCss.includes('crazy-conic-glow'), 'crazy-conic-glow rainbow animation eliminated');
    assert.ok(!crazyCss.includes('#ec4899'), 'Hot pink / magenta bloom removed from skin-crazy.css');

    // Refined 1.5px semi-transparent outlines & backdrop blur
    assert.ok(crazyCss.includes('1.5px solid rgba(255, 255, 255, 0.10)'), 'Refined 1.5px semi-transparent outline');
    assert.ok(crazyCss.includes('backdrop-filter: blur(20px)'), 'Backdrop blur 16-24px on chrome & panels');

    // Spotlight glow opacity strictly capped at 0.15
    assert.ok(crazyCss.includes('opacity: 0.15;'), 'Spotlight glow opacity strictly capped at 0.15');

    // 4 Muted Accent Palettes in themes.css
    const themesCss = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'css', 'themes.css'), 'utf8');
    assert.ok(themesCss.includes('[data-palette="graphite"]'), 'Defines Graphite palette');
    assert.ok(themesCss.includes('#4f8ff7'), 'Graphite features electric blue accent');
    assert.ok(themesCss.includes('[data-palette="slate"]'), 'Defines Slate palette');
    assert.ok(themesCss.includes('#38bdf8'), 'Slate features icy blue accent');
    assert.ok(themesCss.includes('[data-palette="mocha"]'), 'Defines Mocha palette');
    assert.ok(themesCss.includes('#f59e0b'), 'Mocha features amber accent');
    assert.ok(themesCss.includes('[data-palette="midnight_blue"]'), 'Defines Midnight Blue palette');
    assert.ok(themesCss.includes('#2563eb'), 'Midnight Blue features cobalt accent');
  });

  await t.test('Feature: Mayank White Skin Architecture & Assets', () => {
    // skin-mayank.css validation
    const mayankCssPath = path.join(ROOT_DIR, 'ui', 'css', 'skin-mayank.css');
    assert.ok(fs.existsSync(mayankCssPath), 'ui/css/skin-mayank.css exists');
    const mayankCss = fs.readFileSync(mayankCssPath, 'utf8');

    assert.ok(mayankCss.includes('[data-skin="mayank"]'), 'Scoped to data-skin="mayank"');
    assert.ok(mayankCss.includes('#f4f6fa'), 'Off-white background #f4f6fa');
    assert.ok(mayankCss.includes('#1e293b'), 'Charcoal text color #1e293b');
    assert.ok(mayankCss.includes('#f97316'), 'Warm coral accent #f97316');
    assert.ok(mayankCss.includes('rgba(163, 177, 198, 0.35)'), 'Soft dual-layer neumorphic drop shadow');

    // fx-mayank.js validation
    const mayankJsPath = path.join(ROOT_DIR, 'ui', 'js', 'fx-mayank.js');
    assert.ok(fs.existsSync(mayankJsPath), 'ui/js/fx-mayank.js exists');
    const mayankJs = fs.readFileSync(mayankJsPath, 'utf8');

    assert.ok(mayankJs.includes('1000 / 30'), 'Caps animation at 30 FPS');
    assert.ok(mayankJs.includes('visibilitychange'), 'Pauses animation on document.hidden');
    assert.ok(mayankJs.includes('weather-orb-canvas'), 'Renders glowing weather orb canvas');
    assert.ok(mayankJs.includes('prefers-reduced-motion'), 'Respects prefers-reduced-motion');
  });

  await t.test('Feature: Bootloader Skin Isolation & Live Hot Switching', () => {
    const bootJs = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'boot.js'), 'utf8');
    assert.ok(bootJs.includes("activeSkin === 'mayank'"), 'Injects Mayank assets when activeSkin is mayank');
    assert.ok(bootJs.includes('css/skin-${activeSkin}.css') || bootJs.includes('css/skin-'), 'Injects active skin stylesheet');
    assert.ok(bootJs.includes('switchSkin'), 'Exposes switchSkin helper');
    assert.ok(bootJs.includes('switchPalette'), 'Exposes switchPalette live CSS switcher');

    const storageRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage.rs'), 'utf8');
    assert.ok(storageRs.includes('accent_palette'), 'Storage tracks accent_palette');
    assert.ok(storageRs.includes('mayank'), 'Storage accepts mayank as valid skin');

    const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('skin-card-mayank'), 'Renders Mayank White skin card in Settings');
    assert.ok(indexHtml.includes('setting-accent-palette'), 'Renders Accent Palette selector in Settings');
  });
});
