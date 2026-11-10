const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

test('Milestone R6: Modular Background Registry & Night Globe Upgrade Suite', async (t) => {
  await t.test('Feature: Modular Background Registry (18 Styles & Eco Rules)', () => {
    const registryPath = path.join(ROOT_DIR, 'ui', 'js', 'fx-registry.js');
    assert.ok(fs.existsSync(registryPath), 'ui/js/fx-registry.js exists');
    const content = fs.readFileSync(registryPath, 'utf8');

    // Standard lifecycle methods
    assert.ok(content.includes('init('), 'Provides standard init lifecycle');
    assert.ok(content.includes('update('), 'Provides standard update lifecycle');
    assert.ok(content.includes('draw('), 'Provides standard draw lifecycle');
    assert.ok(content.includes('destroy('), 'Provides clean destroy lifecycle');

    // Eco rules: 30 FPS, visibilitychange pause, prefers-reduced-motion
    assert.ok(content.includes('1000 / 30'), 'Enforces 30 FPS maximum animation cap');
    assert.ok(content.includes('visibilitychange'), 'Pauses animation loop when tab is hidden');
    assert.ok(content.includes('prefers-reduced-motion'), 'Respects prefers-reduced-motion setting');

    // All 18 registered styles
    const expectedStyles = [
      'aurora', 'deep_space', 'constellation', 'matrix_rain', 'waves',
      'fireflies', 'minimal_grid', 'geometric_drift', 'sunset_horizon',
      'bioluminescence', 'cyber_mesh', 'wind_lines', 'fog', 'bokeh',
      'warp_speed', 'starfield', 'solar_flare', 'ripple_pond'
    ];

    for (const style of expectedStyles) {
      assert.ok(content.includes(`name: '${style}'`), `Contains style definition for '${style}'`);
    }

    // Match Theme resolution logic
    assert.ok(content.includes('resolveThemeStyle'), 'Includes Match Theme auto-selection resolver');
    assert.ok(content.includes("'wind_lines'"), 'Maps Mayank skin to wind_lines');

    // Settings UI integration
    const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('setting-bg-style'), 'Renders Background Effect selector in Settings');
    assert.ok(indexHtml.includes('value="match_theme"'), 'Provides Match Theme option');
  });

  await t.test('Feature: Night Globe 20% Increase & High-Detail Texture Shader', () => {
    // 20% size increase (--globe-size: 154px)
    const newtabCss = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'css', 'newtab.css'), 'utf8');
    assert.ok(newtabCss.includes('--globe-size: 154px'), 'Sets --globe-size to 154px (+20% size increase)');
    assert.ok(newtabCss.includes('var(--globe-size, 154px)'), 'Applies --globe-size on .globe-slot');

    // High detail R8 night lights shader tinting & mipmaps
    const globeJs = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'globe.js'), 'utf8');
    assert.ok(globeJs.includes('R8') && globeJs.includes('11 MB'), 'Shader implements warm amber R8 night lights tinting (~11 MB VRAM)');
    assert.ok(globeJs.includes('generateMipmap'), 'Generates mipmaps for textures');
    assert.ok(globeJs.includes('anisotropic') || globeJs.includes('TEXTURE_MAX_ANISOTROPY'), 'Supports anisotropic texture filtering');
    assert.ok(globeJs.includes('1000 / 30'), 'Caps globe rendering at 30 FPS');
    assert.ok(globeJs.includes('visibilitychange'), 'Pauses globe when document is hidden');
  });
});
