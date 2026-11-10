//! Empirical Platform Trait Lifecycle & Bounds Stress Testing Suite
//! Challenger R0-2: Platform Trait Lifecycle & Bounds Stress Testing Challenger.
//!
//! Objectives:
//! 1. Rapid lifecycle transitions (create, show, hide, suspend, resume, destroy).
//! 2. Boundary tests for `set_bounds`: zero width/height, off-screen negative, oversized.
//! 3. Script evaluation: complex JS, unicode, syntax errors, oversized payloads.
//! 4. Suspension calls while already suspended or after resuming (idempotency, error handling).
//! 5. Verification across Linux/Stub platform abstraction and Windows PlatformHost/WebView.

#![allow(dead_code)]
#![allow(unused_imports)]

#[path = "../src/tab.rs"]
mod tab;

#[path = "../src/workspace.rs"]
mod workspace;

#[path = "../src/storage.rs"]
mod storage;

#[path = "../src/telemetry.rs"]
mod telemetry;

pub mod ui {
    #[path = "../../src/ui/app_protocol.rs"]
    pub mod app_protocol;
}

#[path = "../src/platform/mod.rs"]
mod platform;

use platform::{
    PlatformHost, PlatformWebView, WebViewConfig,
    linux::{LinuxWebView, StubPlatformHost},
};
use tao::dpi::{LogicalPosition, LogicalSize, Position, Size};
use wry::Rect;

// ============================================================================
// SUITE 1: Stub / Linux Platform Layer Stress Testing
// ============================================================================

#[test]
fn test_stub_rapid_lifecycle_transitions() {
    let bounds = Rect {
        position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
        size: Size::Logical(LogicalSize::new(800.0, 600.0)),
    };
    let wv = LinuxWebView::new_stub(bounds, "about:blank".to_string());

    // Rapid 5,000 cycles of visibility toggles, suspend/resume, and memory targets
    for i in 0..5_000 {
        wv.set_visible(i % 2 == 0).expect("set_visible failed");
        if i % 3 == 0 {
            wv.suspend().expect("suspend failed");
            assert!(wv.is_suspended());
            wv.resume().expect("resume failed");
            assert!(!wv.is_suspended());
        }
        if i % 5 == 0 {
            wv.set_memory_target_low().expect("set_memory_target_low failed");
            wv.set_memory_target_normal().expect("set_memory_target_normal failed");
        }
    }
}

#[test]
fn test_stub_boundary_bounds() {
    let initial_bounds = Rect {
        position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
        size: Size::Logical(LogicalSize::new(800.0, 600.0)),
    };
    let wv = LinuxWebView::new_stub(initial_bounds, "about:blank".to_string());

    // 1. Zero width and height
    let zero_bounds = Rect {
        position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
        size: Size::Logical(LogicalSize::new(0.0, 0.0)),
    };
    wv.set_bounds(zero_bounds).expect("zero bounds failed");
    let b = wv.bounds().expect("get bounds failed");
    match (b.position, b.size) {
        (Position::Logical(p), Size::Logical(s)) => {
            assert_eq!(p.x, 0.0);
            assert_eq!(p.y, 0.0);
            assert_eq!(s.width, 0.0);
            assert_eq!(s.height, 0.0);
        }
        _ => panic!("Expected Logical coordinates"),
    }

    // 2. Off-screen negative coordinates
    let neg_bounds = Rect {
        position: Position::Logical(LogicalPosition::new(-9999.5, -4500.25)),
        size: Size::Logical(LogicalSize::new(100.0, 200.0)),
    };
    wv.set_bounds(neg_bounds).expect("negative position bounds failed");
    let b = wv.bounds().expect("get bounds failed");
    match (b.position, b.size) {
        (Position::Logical(p), Size::Logical(s)) => {
            assert_eq!(p.x, -9999.5);
            assert_eq!(p.y, -4500.25);
            assert_eq!(s.width, 100.0);
            assert_eq!(s.height, 200.0);
        }
        _ => panic!("Expected Logical coordinates"),
    }

    // 3. Oversized giant coordinates
    let giant_bounds = Rect {
        position: Position::Logical(LogicalPosition::new(1_000_000.0, 2_000_000.0)),
        size: Size::Logical(LogicalSize::new(50_000_000.0, 80_000_000.0)),
    };
    wv.set_bounds(giant_bounds).expect("oversized bounds failed");
    let b = wv.bounds().expect("get bounds failed");
    match (b.position, b.size) {
        (Position::Logical(p), Size::Logical(s)) => {
            assert_eq!(p.x, 1_000_000.0);
            assert_eq!(p.y, 2_000_000.0);
            assert_eq!(s.width, 50_000_000.0);
            assert_eq!(s.height, 80_000_000.0);
        }
        _ => panic!("Expected Logical coordinates"),
    }

    // 4. Sub-pixel precision and float bounds
    let subpixel_bounds = Rect {
        position: Position::Logical(LogicalPosition::new(12.34567, 89.101112)),
        size: Size::Logical(LogicalSize::new(456.789, 789.012)),
    };
    wv.set_bounds(subpixel_bounds).expect("subpixel bounds failed");
    let b = wv.bounds().expect("get bounds failed");
    match (b.position, b.size) {
        (Position::Logical(p), Size::Logical(s)) => {
            assert!((p.x - 12.34567).abs() < 1e-5);
            assert!((p.y - 89.101112).abs() < 1e-5);
            assert!((s.width - 456.789).abs() < 1e-5);
            assert!((s.height - 789.012).abs() < 1e-5);
        }
        _ => panic!("Expected Logical coordinates"),
    }
}

#[test]
fn test_stub_suspension_idempotency_and_cycles() {
    let bounds = Rect {
        position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
        size: Size::Logical(LogicalSize::new(800.0, 600.0)),
    };
    let wv = LinuxWebView::new_stub(bounds, "about:blank".to_string());

    assert!(!wv.is_suspended());

    // Suspend once
    wv.suspend().expect("first suspend should succeed");
    assert!(wv.is_suspended());

    // Double suspend (must be idempotent, not error or panic)
    wv.suspend().expect("double suspend should be idempotent");
    assert!(wv.is_suspended());

    // Resume once
    wv.resume().expect("first resume should succeed");
    assert!(!wv.is_suspended());

    // Double resume (must be idempotent, not error or panic)
    wv.resume().expect("double resume should be idempotent");
    assert!(!wv.is_suspended());

    // Rapid alternating cycles
    for _ in 0..1_000 {
        wv.suspend().unwrap();
        assert!(wv.is_suspended());
        wv.resume().unwrap();
        assert!(!wv.is_suspended());
    }
}

#[test]
fn test_stub_script_evaluation_stress() {
    let bounds = Rect {
        position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
        size: Size::Logical(LogicalSize::new(800.0, 600.0)),
    };
    let wv = LinuxWebView::new_stub(bounds, "about:blank".to_string());

    // 1. Complex JS
    let complex_js = r#"
        (() => {
            const arr = Array.from({ length: 1000 }, (_, i) => ({ id: i, val: Math.random() }));
            const mapped = arr.filter(x => x.id % 2 === 0).map(x => x.val * 2);
            return mapped.reduce((acc, v) => acc + v, 0);
        })();
    "#;
    wv.evaluate_script(complex_js).expect("complex JS eval failed");

    // 2. Syntax error payload
    let syntax_err_js = "function broken( { let 123 = ; return ???;";
    // On stub, evaluate_script does not run a JS engine so it succeeds safely without crashing
    wv.evaluate_script(syntax_err_js).expect("syntax error JS should not panic host");

    // 3. Multi-language Unicode, emoji, RTL, and control characters
    let unicode_js = r#"console.log("🚀🔥 Rust Browser — العربية — 中文 (简体/繁體) — 日本語 — 한국어 — \u0000\u0007\t\n\r");"#;
    wv.evaluate_script(unicode_js).expect("unicode JS eval failed");

    // 4. Oversized script payload (5 MB string)
    let giant_str = "x".repeat(5 * 1024 * 1024);
    let giant_script = format!("const giant = \"{}\";", giant_str);
    wv.evaluate_script(&giant_script).expect("giant script eval failed");
}

#[test]
fn test_stub_platform_host_factory_and_isolation() {
    let mut host = StubPlatformHost::new(None).expect("StubPlatformHost::new failed");

    // Test proxy configuration
    host.configure_proxy(Some("socks5://127.0.0.1:1080")).expect("configure proxy socks5 failed");
    host.configure_proxy(Some("http://127.0.0.1:8080")).expect("configure proxy http failed");
    host.configure_proxy(None).expect("clear proxy failed");

    // Test sample_memory
    let mem = host.sample_memory(2).expect("sample_memory failed");
    assert!(mem.total_private_ws_mb >= 0.0);
}

// ============================================================================
// SUITE 2: Real Windows WebView2 & PlatformHost Stress Testing
// ============================================================================

#[cfg(target_os = "windows")]
mod windows_stress {
    use super::*;
    use platform::windows::WindowsPlatformHost;
    use tao::event_loop::EventLoopBuilder;
    use tao::platform::windows::EventLoopBuilderExtWindows;
    use tao::window::WindowBuilder;

    #[test]
    fn test_windows_platform_host_proxy_and_telemetry() {
        let temp_dir = std::env::temp_dir().join(format!("rusty_test_host_{}", std::process::id()));
        let mut host = WindowsPlatformHost::new(Some(temp_dir.clone()))
            .expect("WindowsPlatformHost::new failed");

        // Proxy configurations
        host.configure_proxy(Some("socks5://127.0.0.1:9050"))
            .expect("SOCKS5 proxy config failed");
        host.configure_proxy(Some("http://proxy.example.com:8080"))
            .expect("HTTP proxy config failed");
        host.configure_proxy(None).expect("Proxy clear failed");

        // Malformed proxy should fail gracefully with Result::Err, not panic
        let bad_proxy = host.configure_proxy(Some(":::invalid-url:::"));
        assert!(bad_proxy.is_err(), "Invalid proxy URL must return Err");

        // Sample memory
        let breakdown = host.sample_memory(1).expect("sample_memory failed");
        assert!(breakdown.total_private_ws_mb > 0.0);
        assert!(breakdown.process_count >= 1);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_windows_webview_real_lifecycle_and_bounds_stress() {
        // Create an STA event loop and invisible window
        let event_loop = EventLoopBuilder::new().with_any_thread(true).build();
        let window = WindowBuilder::new()
            .with_visible(false)
            .with_inner_size(LogicalSize::new(800.0, 600.0))
            .build(&event_loop)
            .expect("Failed to build hidden window for testing");

        let temp_dir = std::env::temp_dir().join(format!("rusty_test_wv_{}", std::process::id()));
        let mut host = WindowsPlatformHost::new(Some(temp_dir.clone()))
            .expect("WindowsPlatformHost::new failed");

        let mut config = WebViewConfig::new("about:blank");
        config.bounds = Rect {
            position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
            size: Size::Logical(LogicalSize::new(800.0, 600.0)),
        };

        let wv = host
            .create_webview(&window, config)
            .expect("Failed to create real WebView2 via PlatformHost");

        // 1. Bounds Stress: Zero, Negative, Oversized
        println!("[Windows Stress] Testing boundary bounds...");
        // Zero bounds
        let zero_bounds = Rect {
            position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
            size: Size::Logical(LogicalSize::new(0.0, 0.0)),
        };
        wv.set_bounds(zero_bounds).expect("Real WebView2 zero bounds failed");
        assert_eq!(wv.bounds().unwrap().size, Size::Logical(LogicalSize::new(0.0, 0.0)));

        // Negative coordinates
        let neg_bounds = Rect {
            position: Position::Logical(LogicalPosition::new(-2000.0, -1500.0)),
            size: Size::Logical(LogicalSize::new(300.0, 300.0)),
        };
        wv.set_bounds(neg_bounds).expect("Real WebView2 negative bounds failed");

        // Giant oversized coordinates
        let giant_bounds = Rect {
            position: Position::Logical(LogicalPosition::new(50_000.0, 50_000.0)),
            size: Size::Logical(LogicalSize::new(100_000.0, 100_000.0)),
        };
        wv.set_bounds(giant_bounds).expect("Real WebView2 giant bounds failed");

        // Restore normal bounds
        let normal_bounds = Rect {
            position: Position::Logical(LogicalPosition::new(0.0, 50.0)),
            size: Size::Logical(LogicalSize::new(800.0, 550.0)),
        };
        wv.set_bounds(normal_bounds).expect("Restore normal bounds failed");

        // 2. Rapid Visibility Toggles (500 cycles)
        println!("[Windows Stress] Testing 500 visibility toggles...");
        for i in 0..500 {
            wv.set_visible(i % 2 == 0).expect("Visibility toggle failed");
        }
        wv.set_visible(true).expect("Set visible failed");

        // 3. Script Evaluation: Complex JS, Unicode, Syntax Error, Large String
        println!("[Windows Stress] Testing script evaluation...");
        // Valid complex JS
        wv.evaluate_script("console.log('Stress test log from PlatformWebView'); window.__test_flag = 42;")
            .expect("Evaluate valid JS failed");

        // Unicode with emojis and RTL
        wv.evaluate_script("console.log('🚀 🔥 🦀 Universal Platform Abstraction: 中文 / العربية / English');")
            .expect("Evaluate unicode JS failed");

        // Syntax error in JS: WebView2 evaluate_script is asynchronous execution on renderer
        // The host IPC dispatch must not panic or fail
        let res_err = wv.evaluate_script("function() { broken syntax !!! @@@");
        assert!(res_err.is_ok(), "evaluate_script dispatch of invalid syntax must succeed on host without panic");

        // Large payload script (1 MB string)
        let large_payload = format!("window.__large_str = '{}';", "A".repeat(1024 * 1024));
        wv.evaluate_script(&large_payload).expect("Evaluate large payload script failed");

        // 4. Suspension Preconditions & Error Handling
        println!("[Windows Stress] Testing suspension while visible error handling...");
        assert!(!wv.is_suspended());

        // Attempting to suspend while VISIBLE must return an Err (0x8007139F), NOT panic
        let err_visible_suspend = wv.suspend();
        assert!(err_visible_suspend.is_err(), "Suspending visible WebView2 must return Err gracefully");
        assert!(!wv.is_suspended(), "Failed suspend must not update is_suspended atomic");

        // Now hide the webview (precondition for WebView2 TrySuspend)
        wv.set_visible(false).expect("hide webview before suspend failed");

        // Normal suspend on hidden view
        wv.suspend().expect("suspend on hidden webview must succeed");
        assert!(wv.is_suspended());

        // Double suspend: WebView2 TrySuspend called while already suspended
        // Should succeed or handle gracefully without panic
        let double_suspend = wv.suspend();
        println!("[Windows Stress] Double suspend result: {:?}", double_suspend);
        assert!(wv.is_suspended());

        // Normal resume
        wv.resume().expect("resume failed");
        assert!(!wv.is_suspended());

        // Double resume: WebView2 Resume called while already active
        let double_resume = wv.resume();
        println!("[Windows Stress] Double resume result: {:?}", double_resume);
        assert!(!wv.is_suspended());

        // Rapid 100 cycles of suspend / resume
        for _ in 0..100 {
            wv.suspend().expect("rapid suspend failed");
            assert!(wv.is_suspended());
            wv.resume().expect("rapid resume failed");
            assert!(!wv.is_suspended());
        }

        // 5. Memory Targets (Low / Normal)
        println!("[Windows Stress] Testing memory targets...");
        for _ in 0..50 {
            wv.set_memory_target_low().expect("set_memory_target_low failed");
            wv.set_memory_target_normal().expect("set_memory_target_normal failed");
        }

        // 6. Navigation and HTML loading
        wv.load_html("<html><body><h1>Empirical Stress Verification</h1></body></html>")
            .expect("load_html failed");
        wv.load_url("about:blank").expect("load_url failed");

        // 7. Dropping webview cleanly
        drop(wv);
        drop(window);
        drop(host);
        let _ = std::fs::remove_dir_all(&temp_dir);
        println!("[Windows Stress] Webview dropped cleanly without hang or leak.");
    }

    #[test]
    fn test_windows_rapid_create_destroy_cycle() {
        println!("[Windows Stress] Testing rapid create/destroy of 10 webviews...");
        let event_loop = EventLoopBuilder::new().with_any_thread(true).build();
        let window = WindowBuilder::new()
            .with_visible(false)
            .build(&event_loop)
            .expect("Failed to build hidden window");

        let temp_dir = std::env::temp_dir().join(format!("rusty_test_rapid_{}", std::process::id()));
        let mut host = WindowsPlatformHost::new(Some(temp_dir.clone()))
            .expect("WindowsPlatformHost::new failed");

        for i in 0..10 {
            let mut config = WebViewConfig::new("about:blank");
            config.bounds = Rect {
                position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
                size: Size::Logical(LogicalSize::new(400.0, 300.0)),
            };
            config.is_incognito = i % 2 == 1;

            let wv = host
                .create_webview(&window, config)
                .expect("Create webview in rapid loop failed");

            wv.set_visible(false).unwrap();
            wv.set_bounds(Rect {
                position: Position::Logical(LogicalPosition::new(10.0 * i as f64, 10.0 * i as f64)),
                size: Size::Logical(LogicalSize::new(500.0, 400.0)),
            }).unwrap();
            wv.evaluate_script(&format!("window.__iter = {};", i)).unwrap();

            drop(wv);
        }

        drop(window);
        drop(host);
        let _ = std::fs::remove_dir_all(&temp_dir);
        println!("[Windows Stress] Rapid create/destroy cycle completed successfully.");
    }
}
