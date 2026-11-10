//! Ad blocker engine & WebKit content-blocking rule converter for Rusty Browser.
//!
//! Provides filter-list parsing, conversion to WebKitGTK JSON content-blocking rules,
//! cosmetic element hiding injection, and rule-budget verification.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Upper bound on rules compiled into a single WebKitUserContentFilterStore.
/// WebKit's bytecode compiler rejects filter lists exceeding this threshold.
pub const WEBKIT_RULE_COUNT_LIMIT: usize = 150_000;

/// Default sample adblocking rules included out-of-the-box.
pub const DEFAULT_FILTER_RULES: &[&str] = &[
    // Common ad network domains
    "||doubleclick.net^",
    "||google-analytics.com^",
    "||googlesyndication.com^",
    "||adnxs.com^",
    "||adservice.google.com^",
    "||scorecardresearch.com^",
    "||quantserve.com^",
    "||amazon-adsystem.com^",
    // Trackers & telemetry
    "||telemetry.microsoft.com^",
    "||metrics.icloud.com^",
    // Exceptions
    "@@||fonts.googleapis.com^",
    // Cosmetic hiding
    "##.adsbygoogle",
    "##.ad-banner",
    "##.sponsor-post",
    "###cookie-banner",
];

/// WebKit Trigger object in content blocking JSON schema.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebKitTrigger {
    #[serde(rename = "url-filter")]
    pub url_filter: String,
    #[serde(rename = "url-filter-is-case-sensitive", skip_serializing_if = "Option::is_none")]
    pub is_case_sensitive: Option<bool>,
    #[serde(rename = "resource-type", skip_serializing_if = "Option::is_none")]
    pub resource_types: Option<Vec<String>>,
    #[serde(rename = "load-type", skip_serializing_if = "Option::is_none")]
    pub load_types: Option<Vec<String>>,
    #[serde(rename = "if-domain", skip_serializing_if = "Option::is_none")]
    pub if_domains: Option<Vec<String>>,
    #[serde(rename = "unless-domain", skip_serializing_if = "Option::is_none")]
    pub unless_domains: Option<Vec<String>>,
}

/// WebKit Action object in content blocking JSON schema.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebKitAction {
    #[serde(rename = "type")]
    pub action_type: String, // "block", "ignore-previous-rules", "block-cookies", "css-display-none"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selector: Option<String>,
}

/// Single WebKit Content-Blocking Rule.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebKitContentRule {
    pub trigger: WebKitTrigger,
    pub action: WebKitAction,
}

/// Parsed filter rule categories.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedRule {
    /// Network request block (e.g. `||badsite.com^`)
    Block { domain_pattern: String, third_party_only: bool },
    /// Whitelist exception (e.g. `@@||safe.com^`)
    Allow { domain_pattern: String },
    /// Cosmetic CSS selector to hide (e.g. `##.adsbygoogle` or `example.com##.sponsor`)
    Cosmetic { domain: Option<String>, selector: String },
    /// Unsupported or comment
    Ignored,
}

/// Linux WebKit adblock converter and manager.
pub struct AdBlockManager {
    rules: Vec<String>,
    cosmetic_css: String,
    webkit_json: String,
    rule_count: usize,
}

impl AdBlockManager {
    /// Initialize with the default filter set.
    pub fn new() -> Self {
        let rules: Vec<String> = DEFAULT_FILTER_RULES.iter().map(|&s| s.to_string()).collect();
        Self::from_rules(rules)
    }

    /// Build manager from a slice of rule strings (e.g. EasyList lines).
    pub fn from_rules(raw_rules: Vec<String>) -> Self {
        let mut parsed_rules = Vec::new();
        let mut cosmetic_selectors = Vec::new();
        let mut webkit_rules: Vec<WebKitContentRule> = Vec::new();
        let mut seen = HashSet::new();

        for line in &raw_rules {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('!') || trimmed.starts_with('#') && !trimmed.starts_with("##") && !trimmed.starts_with("#?#") {
                continue;
            }

            if !seen.insert(trimmed.to_string()) {
                continue;
            }

            let rule = Self::parse_rule(trimmed);
            match &rule {
                ParsedRule::Block { domain_pattern, third_party_only } => {
                    let regex = Self::domain_pattern_to_regex(domain_pattern);
                    let mut trigger = WebKitTrigger {
                        url_filter: regex,
                        is_case_sensitive: Some(false),
                        resource_types: None,
                        load_types: None,
                        if_domains: None,
                        unless_domains: None,
                    };
                    if *third_party_only {
                        trigger.load_types = Some(vec!["third-party".to_string()]);
                    }
                    webkit_rules.push(WebKitContentRule {
                        trigger,
                        action: WebKitAction {
                            action_type: "block".to_string(),
                            selector: None,
                        },
                    });
                    parsed_rules.push(rule);
                }
                ParsedRule::Allow { domain_pattern } => {
                    let regex = Self::domain_pattern_to_regex(domain_pattern);
                    webkit_rules.push(WebKitContentRule {
                        trigger: WebKitTrigger {
                            url_filter: regex,
                            is_case_sensitive: Some(false),
                            resource_types: None,
                            load_types: None,
                            if_domains: None,
                            unless_domains: None,
                        },
                        action: WebKitAction {
                            action_type: "ignore-previous-rules".to_string(),
                            selector: None,
                        },
                    });
                    parsed_rules.push(rule);
                }
                ParsedRule::Cosmetic { domain: _, selector } => {
                    cosmetic_selectors.push(selector.clone());
                    webkit_rules.push(WebKitContentRule {
                        trigger: WebKitTrigger {
                            url_filter: ".*".to_string(),
                            is_case_sensitive: None,
                            resource_types: None,
                            load_types: None,
                            if_domains: None,
                            unless_domains: None,
                        },
                        action: WebKitAction {
                            action_type: "css-display-none".to_string(),
                            selector: Some(selector.clone()),
                        },
                    });
                    parsed_rules.push(rule);
                }
                ParsedRule::Ignored => {}
            }

            if webkit_rules.len() >= WEBKIT_RULE_COUNT_LIMIT {
                tracing::warn!(
                    "[adblock] Filter list reached WebKit rule count limit of {WEBKIT_RULE_COUNT_LIMIT}. Truncating."
                );
                break;
            }
        }

        // Generate combined CSS for injected cosmetic filtering
        let cosmetic_css = if cosmetic_selectors.is_empty() {
            String::new()
        } else {
            format!("{} {{ display: none !important; }}", cosmetic_selectors.join(", "))
        };

        let webkit_json = serde_json::to_string(&webkit_rules).unwrap_or_else(|_| "[]".to_string());
        let rule_count = webkit_rules.len();

        Self {
            rules: raw_rules,
            cosmetic_css,
            webkit_json,
            rule_count,
        }
    }

    /// Parse an EasyList line into a structured ParsedRule.
    pub fn parse_rule(line: &str) -> ParsedRule {
        if line.starts_with("@@") {
            let clean = line.trim_start_matches("@@");
            let pattern = clean.trim_start_matches("||").trim_end_matches('^');
            return ParsedRule::Allow {
                domain_pattern: pattern.to_string(),
            };
        }

        if let Some(pos) = line.find("##") {
            let (dom, sel) = line.split_at(pos);
            let sel = &sel[2..];
            let domain = if dom.is_empty() {
                None
            } else {
                Some(dom.to_string())
            };
            return ParsedRule::Cosmetic {
                domain,
                selector: sel.to_string(),
            };
        }

        if let Some(rest) = line.strip_prefix("||") {
            let mut third_party = false;
            let pattern = if let Some(dollar_pos) = rest.find('$') {
                let opts = &rest[dollar_pos + 1..];
                if opts.contains("third-party") {
                    third_party = true;
                }
                &rest[..dollar_pos]
            } else {
                rest
            };
            let clean_pat = pattern.trim_end_matches('^');
            return ParsedRule::Block {
                domain_pattern: clean_pat.to_string(),
                third_party_only: third_party,
            };
        }

        ParsedRule::Ignored
    }

    /// Converts domain pattern (e.g. `doubleclick.net`) into a WebKit-compatible regex.
    fn domain_pattern_to_regex(pattern: &str) -> String {
        let escaped = regex_escape(pattern);
        format!(".*{escaped}.*")
    }

    /// Compiled JSON string ready for `WebKitUserContentFilterStore`.
    pub fn webkit_content_rules_json(&self) -> &str {
        &self.webkit_json
    }

    /// Injected CSS stylesheet string for cosmetic hiding.
    pub fn cosmetic_stylesheet(&self) -> &str {
        &self.cosmetic_css
    }

    /// Total number of active rules.
    pub fn rule_count(&self) -> usize {
        self.rule_count
    }

    /// Verify whether a domain matches blocking rules locally (for host navigation check).
    pub fn should_block_domain(&self, domain: &str) -> bool {
        let d = domain.to_lowercase();
        for r in &self.rules {
            if r.starts_with("||") {
                let target = r.trim_start_matches("||").trim_end_matches('^').to_lowercase();
                if d == target || d.ends_with(&format!(".{target}")) {
                    return true;
                }
            }
        }
        false
    }
}

impl Default for AdBlockManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Helper to escape characters for regex.
fn regex_escape(s: &str) -> String {
    let mut escaped = String::with_capacity(s.len() * 2);
    for c in s.chars() {
        match c {
            '.' | '^' | '$' | '*' | '+' | '?' | '(' | ')' | '[' | ']' | '{' | '}' | '|' | '\\' => {
                escaped.push('\\');
                escaped.push(c);
            }
            _ => escaped.push(c),
        }
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_adblock_parse_rules() {
        match AdBlockManager::parse_rule("||doubleclick.net^") {
            ParsedRule::Block { domain_pattern, third_party_only } => {
                assert_eq!(domain_pattern, "doubleclick.net");
                assert!(!third_party_only);
            }
            _ => panic!("Expected Block"),
        }

        match AdBlockManager::parse_rule("||badads.com^$third-party") {
            ParsedRule::Block { domain_pattern, third_party_only } => {
                assert_eq!(domain_pattern, "badads.com");
                assert!(third_party_only);
            }
            _ => panic!("Expected third-party Block"),
        }

        match AdBlockManager::parse_rule("@@||safe.com^") {
            ParsedRule::Allow { domain_pattern } => {
                assert_eq!(domain_pattern, "safe.com");
            }
            _ => panic!("Expected Allow"),
        }

        match AdBlockManager::parse_rule("##.banner-ad") {
            ParsedRule::Cosmetic { domain, selector } => {
                assert_eq!(domain, None);
                assert_eq!(selector, ".banner-ad");
            }
            _ => panic!("Expected Cosmetic"),
        }
    }

    #[test]
    fn test_adblock_manager_webkit_json_generation() {
        let manager = AdBlockManager::new();
        let json = manager.webkit_content_rules_json();
        assert!(json.starts_with('[') && json.ends_with(']'));

        // Deserializes cleanly into Vec<WebKitContentRule>
        let rules: Vec<WebKitContentRule> = serde_json::from_str(json).expect("Valid JSON");
        assert!(rules.len() >= 5);
        assert!(manager.rule_count() < WEBKIT_RULE_COUNT_LIMIT);

        // Verify action types present
        let types: HashSet<String> = rules.iter().map(|r| r.action.action_type.clone()).collect();
        assert!(types.contains("block"));
        assert!(types.contains("ignore-previous-rules"));
        assert!(types.contains("css-display-none"));
    }

    #[test]
    fn test_adblock_cosmetic_stylesheet() {
        let manager = AdBlockManager::new();
        let css = manager.cosmetic_stylesheet();
        assert!(css.contains("display: none !important;"));
        assert!(css.contains(".adsbygoogle"));
        assert!(css.contains(".ad-banner"));
    }

    #[test]
    fn test_adblock_domain_check() {
        let manager = AdBlockManager::new();
        assert!(manager.should_block_domain("doubleclick.net"));
        assert!(manager.should_block_domain("ad.doubleclick.net"));
        assert!(manager.should_block_domain("google-analytics.com"));
        assert!(!manager.should_block_domain("wikipedia.org"));
        assert!(!manager.should_block_domain("rust-lang.org"));
    }
}
