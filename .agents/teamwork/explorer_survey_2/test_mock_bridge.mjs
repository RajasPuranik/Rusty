import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';

const UI_DIR = path.resolve('d:/browser/ui');
const PORT = 8976;
const CDP_PORT = 9222;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.txt': 'text/plain'
};

// 1. HTTP server
const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(UI_DIR, safePath === '/' ? 'index.html' : safePath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found: ' + urlPath);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
console.log(`[server] Serving ${UI_DIR} on http://127.0.0.1:${PORT}`);

// 2. Launch Headless Edge
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const tmpDir = path.join(os.tmpdir(), 'edge-test-profile-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });

const browserProc = spawn(edgePath, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${tmpDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-translate',
  '--disable-features=TranslateUI',
  'about:blank'
], { stdio: 'ignore' });

// Wait for CDP
let versionInfo = null;
for (let i = 0; i < 20; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    if (res.ok) {
      versionInfo = await res.json();
      break;
    }
  } catch (_) {}
  await new Promise(r => setTimeout(r, 250));
}

if (!versionInfo) {
  console.error('[error] Could not connect to browser CDP');
  cleanup();
  process.exit(1);
}

console.log('[cdp] Browser connected:', versionInfo.Browser);

// Get page target
const listRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
const targets = await listRes.json();
const pageTarget = targets.find(t => t.type === 'page') || targets[0];
console.log('[cdp] Page target ws:', pageTarget.webSocketDebuggerUrl);

const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
let reqId = 1;
const pending = new Map();
const consoleLogs = [];
const pageExceptions = [];

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(msg.error);
    else resolve(msg.result);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    const type = msg.params.type;
    const text = msg.params.args.map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
    consoleLogs.push({ type, text });
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const desc = msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text;
    pageExceptions.push(desc);
  }
};

await new Promise(r => ws.onopen = r);

function sendCmd(method, params = {}) {
  const id = reqId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await sendCmd('Runtime.enable');
await sendCmd('Page.enable');

async function testPage(urlName, pageUrl) {
  console.log(`\n--- Testing ${urlName} (${pageUrl}) ---`);
  consoleLogs.length = 0;
  pageExceptions.length = 0;

  await sendCmd('Page.navigate', { url: pageUrl });
  await new Promise(r => setTimeout(r, 3000));

  const evalRes = await sendCmd('Runtime.evaluate', {
    expression: `JSON.stringify({
      isMock: window.bridge ? window.bridge.isMock : null,
      title: document.title,
      skin: document.documentElement.getAttribute('data-skin'),
      theme: document.documentElement.getAttribute('data-theme'),
      globeState: window.RustyGlobe ? window.RustyGlobe.getState() : null,
      tabCount: document.querySelectorAll('.tab-item').length,
      dockBtnCount: document.querySelectorAll('.dock-btn').length,
      actionCardCount: document.querySelectorAll('.action-card').length
    })`,
    returnByValue: true
  });

  const parsed = JSON.parse(evalRes.result.value || '{}');
  console.log('Evaluated State:', parsed);
  console.log(`Console calls (${consoleLogs.length}):`);
  for (const log of consoleLogs) {
    console.log(`  [${log.type}] ${log.text}`);
  }
  console.log(`Exceptions (${pageExceptions.length}):`);
  for (const ex of pageExceptions) {
    console.error(`  [EXCEPTION] ${ex}`);
  }
  return { parsed, logs: [...consoleLogs], exceptions: [...pageExceptions] };
}

// Test index.html with Crazy skin
const r1 = await testPage('index.html (default crazy skin)', `http://127.0.0.1:${PORT}/index.html?skin=crazy`);

// Test index.html with Minimal skin
const r2 = await testPage('index.html (minimal skin)', `http://127.0.0.1:${PORT}/index.html?skin=minimal`);

// Test newtab.html standalone
const r3 = await testPage('newtab.html (standalone crazy)', `http://127.0.0.1:${PORT}/newtab.html?skin=crazy`);

// Test newtab.html standalone minimal
const r4 = await testPage('newtab.html (standalone minimal)', `http://127.0.0.1:${PORT}/newtab.html?skin=minimal`);

cleanup();

function cleanup() {
  try { ws.close(); } catch (_) {}
  try { browserProc.kill(); } catch (_) {}
  try { server.close(); } catch (_) {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
}

const totalExceptions = r1.exceptions.length + r2.exceptions.length + r3.exceptions.length + r4.exceptions.length;
console.log(`\n========================================`);
console.log(`Total Uncaught Exceptions across all pages: ${totalExceptions}`);
console.log(`========================================`);
process.exit(totalExceptions > 0 ? 1 : 0);
