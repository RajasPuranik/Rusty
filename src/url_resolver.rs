//! URL resolution — turns user input into a navigable URL or search query.

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use url::Url;

/// The default page for new tabs.
pub const NEW_TAB_URL: &str = "about:blank";

/// Default search engine template. `%s` is replaced with the encoded query.
pub const DEFAULT_SEARCH_TEMPLATE: &str = "https://duckduckgo.com/?q=%s";

/// Resolve raw user input into a navigable URL.
///
/// - If it parses as an http(s) URL, use it directly.
/// - If it looks like a bare domain (contains a dot, no spaces), prepend `https://`.
/// - Otherwise treat it as a search query.
pub fn resolve(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return NEW_TAB_URL.to_owned();
    }

    // Already a valid http(s) URL?
    if let Ok(parsed) = Url::parse(trimmed) {
        if parsed.scheme() == "http" || parsed.scheme() == "https" {
            return parsed.into();
        }
    }

    // Bare domain (contains a dot, no spaces)?
    if !trimmed.contains(' ') && trimmed.contains('.') {
        let with_scheme = format!("https://{trimmed}");
        if Url::parse(&with_scheme).is_ok() {
            return with_scheme;
        }
    }

    // Search query
    let encoded = utf8_percent_encode(trimmed, NON_ALPHANUMERIC).to_string();
    DEFAULT_SEARCH_TEMPLATE.replace("%s", &encoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_full_url() {
        let url = resolve("https://www.youtube.com");
        assert_eq!(url, "https://www.youtube.com/");
    }

    #[test]
    fn resolve_bare_domain() {
        let url = resolve("github.com");
        assert_eq!(url, "https://github.com");
    }

    #[test]
    fn resolve_search_query() {
        let url = resolve("rust programming");
        assert!(url.starts_with("https://duckduckgo.com/?q="));
        assert!(url.contains("rust"));
    }

    #[test]
    fn resolve_empty() {
        assert_eq!(resolve(""), NEW_TAB_URL);
    }

    #[test]
    fn resolve_with_spaces() {
        let url = resolve("  https://example.com  ");
        assert_eq!(url, "https://example.com/");
    }
}
