# Renderer Process Limit Evaluation & Security Analysis

**Milestone**: R2 (Feature 13)  
**Target Codebase**: Rusty Browser (`d:\browser`)  
**Evaluated Switch**: `--renderer-process-limit` (Chromium / WebView2 Additional Browser Arguments)

---

## 1. Executive Summary

In desktop browsers using Chromium rendering technology (including WebView2 on Windows 11), Chromium's default process model utilizes **Site Isolation** (Process-per-Site-Instance). Each top-level domain origin is isolated in its own OS renderer process (`msedgewebview2.exe`).

By passing `--renderer-process-limit=N` via `ICoreWebView2EnvironmentOptions::put_AdditionalBrowserArguments`, the browser runtime enforces a hard ceiling on the maximum number of renderer processes allocated for content tabs. Once the limit is saturated, subsequent new tabs share existing renderer processes.

---

## 2. Empirical Benchmark Data

Measurements taken using `verify_5states.ps1` and Windows Performance Counters (Private Working Set) across 10 standardized tabs:

| Configuration | Content Renderers | Total PWS (10 Tabs) | PWS Savings | Peak Tab Latency |
| :--- | :---: | :---: | :---: | :---: |
| **Default (Uncapped)** | 10 | 1,278.5 MB | — (Baseline) | 120 ms |
| **`--renderer-process-limit=4`** | 4 | 894.2 MB | **-30.1% (-384.3 MB)** | 134 ms |
| **`--renderer-process-limit=2`** | 2 | 678.0 MB | **-47.0% (-600.5 MB)** | 162 ms |
| **`--renderer-process-limit=1`** | 1 | 512.4 MB | **-59.9% (-766.1 MB)** | 240 ms |

---

## 3. Security, Stability & Isolation Trade-offs

While capping renderer processes delivers significant RAM reductions (~30% to ~60%), it introduces substantial trade-offs:

### 3.1 Security Compromise (Site Isolation & Speculative Execution)
- **Spectre / Meltdown Vulnerability**: Chromium's Site Isolation architecture was introduced specifically to prevent malicious web pages from reading cross-origin secrets (passwords, cookies, session tokens) via microarchitectural side-channel attacks.
- When tabs share an OS renderer process address space, memory pages are accessible across origins, defeating hardware-level virtual memory isolation.

### 3.2 Crash Blast Radius
- In standard mode, a renderer crash or out-of-memory (OOM) event kills only the single tab that experienced the fault.
- With `--renderer-process-limit=2`, an OOM event or WebAssembly crash in a heavy page terminates all other tabs multiplexed into that same renderer process.

### 3.3 UI Responsiveness Under Heavy CPU / JS Load
- A single tab executing compute-heavy JavaScript or infinite loops blocks the single-threaded event loop for all other pages hosted within that shared renderer process.

---

## 4. Architectural Recommendation

1. **Do NOT Enable Silently by Default**: In compliance with invariant **INV-06** (Honest Security Posture) and **INV-08** (Strict Anti-Faking Mandate), Rusty Browser does not silently compromise site isolation.
2. **Opt-In Lite Mode & Low-RAM Flag**: The renderer process limit is exposed as an optional setting in **Lite Mode** (`--renderer-process-limit=4`) for resource-constrained systems (e.g. 4 GB / 8 GB RAM machines), with clear disclosure of the security trade-offs.
