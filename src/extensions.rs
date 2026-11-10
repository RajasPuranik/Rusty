//! Extension & Userscripts engine for Rusty Browser.
//!
//! Provides:
//! - Manifest inspection for unpacked Chrome / Chromium extensions (V2 & V3).
//! - Security permission risk analysis (flagging high-risk permissions like `<all_urls>`, `webRequest`, `cookies`).
//! - Tampermonkey-compatible Userscripts execution engine for both Windows (WebView2) and Linux (WebKitGTK).
//! - Strict isolation invariants: extensions and userscripts are blocked from `rusty://app/` privileged UI
//!   and automatically disabled in the secure Vault workspace and private windows.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};

use crate::storage::{BrowserExtension, UserScript};

/// Security risk rating calculated from requested extension permissions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExtensionRiskLevel {
    Low,
    Medium,
    High,
}

impl std::fmt::Display for ExtensionRiskLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Low => write!(f, "Low Risk"),
            Self::Medium => write!(f, "Medium Risk"),
            Self::High => write!(f, "High Risk (Broad Access)"),
        }
    }
}

/// Detailed result of inspecting an extension's `manifest.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestInspection {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub manifest_version: u32,
    pub path: String,
    pub permissions: Vec<String>,
    pub high_risk_permissions: Vec<String>,
    pub risk_level: ExtensionRiskLevel,
    pub has_background: bool,
    pub has_content_scripts: bool,
    pub icons: HashMap<String, String>,
}

/// Minimal manifest representation for JSON deserialization.
#[derive(Debug, Deserialize)]
struct RawManifest {
    pub name: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    pub manifest_version: Option<u32>,
    pub permissions: Option<Vec<String>>,
    pub host_permissions: Option<Vec<String>>,
    #[allow(dead_code)]
    pub optional_permissions: Option<Vec<String>>,
    pub background: Option<serde_json::Value>,
    pub content_scripts: Option<serde_json::Value>,
    pub icons: Option<HashMap<String, String>>,
}

/// Known high-risk permission tokens that grant broad host access or interception.
const HIGH_RISK_PERMISSIONS: &[&str] = &[
    "<all_urls>",
    "*://*/*",
    "http://*/*",
    "https://*/*",
    "webRequest",
    "webRequestBlocking",
    "cookies",
    "nativeMessaging",
    "debugger",
    "declarativeNetRequest",
    "proxy",
    "management",
    "downloads",
    "privacy",
];

/// Assess the risk level based on the set of requested permissions.
pub fn evaluate_risk_level(permissions: &[String]) -> (Vec<String>, ExtensionRiskLevel) {
    let mut high_risk = Vec::new();
    for p in permissions {
        let p_trimmed = p.trim();
        if HIGH_RISK_PERMISSIONS.iter().any(|hr| hr.eq_ignore_ascii_case(p_trimmed))
            || p_trimmed.starts_with("*://")
            || p_trimmed.starts_with("http://")
            || p_trimmed.starts_with("https://")
        {
            high_risk.push(p.clone());
        }
    }

    let level = if high_risk.iter().any(|p| p == "<all_urls>" || p.contains("webRequest") || p == "cookies") {
        ExtensionRiskLevel::High
    } else if !high_risk.is_empty() || permissions.len() > 6 {
        ExtensionRiskLevel::Medium
    } else {
        ExtensionRiskLevel::Low
    };

    (high_risk, level)
}

/// Inspect an extension directory containing a `manifest.json`.
pub fn inspect_extension_directory(dir: &Path) -> Result<ManifestInspection> {
    if !dir.is_dir() {
        return Err(anyhow!("Extension path is not a directory: {}", dir.display()));
    }

    let manifest_path = dir.join("manifest.json");
    if !manifest_path.is_file() {
        return Err(anyhow!("manifest.json not found in {}", dir.display()));
    }

    let raw_text = fs::read_to_string(&manifest_path)
        .with_context(|| format!("Failed to read {}", manifest_path.display()))?;

    let parsed: RawManifest = serde_json::from_str(&raw_text)
        .with_context(|| "Failed to parse manifest.json into expected manifest schema")?;

    let name = parsed.name.unwrap_or_else(|| {
        dir.file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Unknown Extension".to_string())
    });

    let version = parsed.version.unwrap_or_else(|| "1.0.0".to_string());
    let description = parsed.description.unwrap_or_default();
    let manifest_version = parsed.manifest_version.unwrap_or(2);

    let mut permissions = parsed.permissions.unwrap_or_default();
    if let Some(host_perms) = parsed.host_permissions {
        for hp in host_perms {
            if !permissions.contains(&hp) {
                permissions.push(hp);
            }
        }
    }

    let (high_risk, risk_level) = evaluate_risk_level(&permissions);

    // Compute stable ID from name and path
    let id = format!("ext_{:x}", md5_digest(format!("{}_{}", name, dir.display()).as_bytes()));

    Ok(ManifestInspection {
        id,
        name,
        version,
        description,
        manifest_version,
        path: dir.to_string_lossy().to_string(),
        permissions,
        high_risk_permissions: high_risk,
        risk_level,
        has_background: parsed.background.is_some(),
        has_content_scripts: parsed.content_scripts.is_some(),
        icons: parsed.icons.unwrap_or_default(),
    })
}

/// Convert an inspected manifest into a persistent `BrowserExtension` record.
pub fn load_unpacked_extension(dir: &Path) -> Result<BrowserExtension> {
    let inspection = inspect_extension_directory(dir)?;
    Ok(BrowserExtension {
        id: inspection.id,
        name: inspection.name,
        version: inspection.version,
        description: inspection.description,
        path: inspection.path,
        enabled: true,
        permissions: inspection.permissions,
        is_unpacked: true,
        icons: inspection.icons,
    })
}

/// Simple deterministic hash helper for unique extension IDs.
fn md5_digest(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// Build the userscript injection runtime script for content webviews.
/// Injects active userscripts and executes them at `document_start` or `document_end`.
/// If `is_vault_workspace` is true, returns an empty script to maintain strict vault isolation.
pub fn build_userscripts_injection_js(userscripts: &[UserScript], is_vault_workspace: bool) -> String {
    if is_vault_workspace {
        return "/* [Rusty Browser Security] Userscripts and extensions inhibited in Vault workspace */".to_string();
    }

    let enabled_scripts: Vec<&UserScript> = userscripts.iter().filter(|s| s.enabled).collect();
    if enabled_scripts.is_empty() {
        return "/* [Rusty Browser] No active userscripts */".to_string();
    }

    let serialized = match serde_json::to_string(&enabled_scripts) {
        Ok(s) => s,
        Err(_) => return "/* [Rusty Browser] Serialization failure */".to_string(),
    };

    format!(
        r#"
(() => {{
  if (window.__RUSTY_USERSCRIPTS_INITIALIZED__) return;
  window.__RUSTY_USERSCRIPTS_INITIALIZED__ = true;

  const currentUrl = window.location.href;
  const isInternal = location.hostname === 'rusty.app' || location.protocol === 'rusty:';
  if (isInternal) return; // Invariant: userscripts NEVER run in internal browser chrome

  const scripts = {serialized};
  if (!Array.isArray(scripts) || scripts.length === 0) return;

  function urlMatches(url, pattern) {{
    if (!pattern || pattern === '<all_urls>' || pattern === '*') return true;
    try {{
      const escaped = pattern
        .replace(/[.+?^${{}}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      const reg = new RegExp('^' + escaped + '$', 'i');
      return reg.test(url);
    }} catch (e) {{
      return false;
    }}
  }}

  function runScript(s) {{
    try {{
      const fn = new Function(s.code);
      fn();
    }} catch (err) {{
      console.warn('[Rusty Userscript Error: ' + (s.name || s.id) + ']', err);
    }}
  }}

  scripts.forEach(s => {{
    if (!s.enabled || !s.code) return;
    const matchFound = Array.isArray(s.matches) && s.matches.some(p => urlMatches(currentUrl, p));
    if (!matchFound) return;

    if (s.run_at === 'document_start') {{{{
      runScript(s);
    }}}} else {{{{
      if (document.readyState === 'loading') {{{{
        document.addEventListener('DOMContentLoaded', () => runScript(s), {{{{ once: true }}}});
      }}}} else {{{{
        runScript(s);
      }}}}
    }}}}
  }});
}})();
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_risk_level_evaluation() {
        let (high_risk, level) = evaluate_risk_level(&["storage".to_string(), "activeTab".to_string()]);
        assert_eq!(level, ExtensionRiskLevel::Low);
        assert!(high_risk.is_empty());

        let (high_risk2, level2) = evaluate_risk_level(&["<all_urls>".to_string(), "storage".to_string()]);
        assert_eq!(level2, ExtensionRiskLevel::High);
        assert_eq!(high_risk2, vec!["<all_urls>"]);

        let (high_risk3, level3) = evaluate_risk_level(&["*://*.github.com/*".to_string()]);
        assert_eq!(level3, ExtensionRiskLevel::Medium);
        assert_eq!(high_risk3.len(), 1);
    }

    #[test]
    fn test_inspect_unpacked_manifest() {
        let temp_dir = std::env::temp_dir().join("rusty_test_ext_unpacked");
        let _ = fs::create_dir_all(&temp_dir);
        let manifest_content = r#"{
            "manifest_version": 3,
            "name": "Sample Ad Blocker",
            "version": "2.1.0",
            "description": "Block annoying popups and trackers",
            "permissions": ["storage", "webRequestBlocking", "<all_urls>"],
            "icons": { "48": "icon48.png" }
        }"#;

        fs::write(temp_dir.join("manifest.json"), manifest_content).unwrap();

        let inspection = inspect_extension_directory(&temp_dir).unwrap();
        assert_eq!(inspection.name, "Sample Ad Blocker");
        assert_eq!(inspection.version, "2.1.0");
        assert_eq!(inspection.manifest_version, 3);
        assert_eq!(inspection.risk_level, ExtensionRiskLevel::High);
        assert!(inspection.high_risk_permissions.contains(&"<all_urls>".to_string()));
        assert!(inspection.high_risk_permissions.contains(&"webRequestBlocking".to_string()));

        let ext = load_unpacked_extension(&temp_dir).unwrap();
        assert_eq!(ext.name, "Sample Ad Blocker");
        assert!(ext.enabled);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_vault_workspace_inhibits_userscripts() {
        let scripts = vec![UserScript {
            id: "test_s1".to_string(),
            name: "Test Script".to_string(),
            version: "1.0.0".to_string(),
            description: "Test".to_string(),
            matches: vec!["<all_urls>".to_string()],
            run_at: "document_start".to_string(),
            enabled: true,
            code: "console.log('injected');".to_string(),
        }];

        // In Vault workspace:
        let vault_js = build_userscripts_injection_js(&scripts, true);
        assert!(vault_js.contains("inhibited in Vault workspace"));
        assert!(!vault_js.contains("test_s1"));

        // In normal workspace:
        let normal_js = build_userscripts_injection_js(&scripts, false);
        assert!(normal_js.contains("test_s1"));
        assert!(normal_js.contains("urlMatches"));
    }
}
