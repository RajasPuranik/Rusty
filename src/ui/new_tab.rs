//! New Tab page — shown when a tab is opened without a URL.

pub const NEW_TAB_HTML: &str = r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    height: 100%;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    background: #1a1a2e;
    color: #e8eaed;
  }
  body {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  h1 {
    font-size: 36px;
    font-weight: 300;
    color: #8ab4f8;
    margin-bottom: 8px;
  }
  p {
    font-size: 14px;
    color: #9aa0a6;
  }
</style>
</head>
<body>
  <h1>Rusty Browser</h1>
  <p>Type a URL or search query in the address bar above</p>
</body>
</html>
"##;
