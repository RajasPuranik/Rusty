//! URL resolution — turns user input into a navigable URL or search query.

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use url::Url;

/// The default page for new tabs.
pub const NEW_TAB_URL: &str = "about:blank";

/// Default search engine template. `%s` is replaced with the encoded query.
pub const DEFAULT_SEARCH_TEMPLATE: &str = "https://duckduckgo.com/?q=%s";

/// Resolve raw user input into a navigable URL using the default search template.
pub fn resolve(raw: &str) -> String {
    resolve_with_template(raw, DEFAULT_SEARCH_TEMPLATE)
}

/// Resolve raw user input into a navigable URL or search query using a specified search template.
///
/// - Internal `about:` URLs are returned directly.
/// - Valid `http://` or `https://` URLs are normalized and returned.
/// - Bare domains (contains '.', no spaces) have `https://` prepended.
/// - Everything else is treated as a search query and formatted into `search_template`.
pub fn resolve_with_template(raw: &str, search_template: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return NEW_TAB_URL.to_owned();
    }

    // Pass through internal about: pages directly
    if trimmed.starts_with("about:") {
        return trimmed.to_owned();
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

    // Search query using template
    let encoded = utf8_percent_encode(trimmed, NON_ALPHANUMERIC).to_string();
    let template = if search_template.contains("%s") {
        search_template
    } else {
        DEFAULT_SEARCH_TEMPLATE
    };
    template.replace("%s", &encoded)
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

    #[test]
    fn resolve_about_page() {
        assert_eq!(resolve("about:settings"), "about:settings");
        assert_eq!(resolve("about:history"), "about:history");
    }

    #[test]
    fn resolve_custom_template() {
        let url = resolve_with_template("rust lang", "https://www.google.com/search?q=%s");
        assert_eq!(url, "https://www.google.com/search?q=rust%20lang");
    }
}
