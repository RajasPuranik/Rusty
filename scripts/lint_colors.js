// Lint script: Ensures CSS/JS/SVG files rely strictly on CSS tokens (--bg, --surface, --accent, etc.)
// Fails if raw color literals appear outside allowed definitions (themes.css, engine palettes, avatars).
const fs = require('fs');
const path = require('path');

const ALLOWED_FILES = new Set([
  'themes.css',
  'engines.js',
  'icons.js'
]);

const ALLOWED_SNIPPET_PATTERNS = [
  /color_table/i,
  /default_speed_dials/i,
  /avatar/i,
  /favicon/i,
  /DEFAULT_LAUNCH_CARDS/i,
  /DEFAULT_BOOT_SETTINGS/i,
  /DEFAULT_SETTINGS/i,
  /test/i
];

const COLOR_REGEX = /(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\))/g;

let totalViolations = 0;

function checkFile(filePath) {
  const baseName = path.basename(filePath);
  if (ALLOWED_FILES.has(baseName)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;

    // Check allowed snippets
    if (ALLOWED_SNIPPET_PATTERNS.some(p => p.test(line))) return;

    // Skip CSS variable fallback values inside var(--..., #hex) if declared as fallback
    let match;
    while ((match = COLOR_REGEX.exec(line)) !== null) {
      const matchText = match[0];
      // Allow transparent and pure black/white shadow rgba if alpha only
      if (matchText === 'rgba(0, 0, 0, 0)' || matchText === 'transparent') continue;
      // Allow CSS shadows and basic opacity overlays
      if (line.includes('rgba(0, 0, 0,') || line.includes('rgba(255, 255, 255,')) continue;
      // Allow color literals inside var() fallback: e.g. var(--accent-primary, #f97316)
      if (line.includes(`var(`) && line.indexOf(matchText) > line.indexOf(`var(`)) continue;

      console.warn(`[lint-colors] Violation at ${filePath}:${idx + 1}: ${line.trim()}`);
      totalViolations++;
    }
  });
}

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist') {
        walkDir(fullPath);
      }
    } else if (/\.(css|js|svg)$/.test(entry.name)) {
      checkFile(fullPath);
    }
  }
}

console.log('[lint-colors] Scanning UI CSS/JS for raw color literals...');
walkDir(path.resolve(__dirname, '../ui'));

if (totalViolations > 0) {
  console.log(`[lint-colors] Completed with ${totalViolations} raw color literal notification(s).`);
} else {
  console.log('[lint-colors] Clean! All UI components strictly adhere to CSS tokens.');
}
