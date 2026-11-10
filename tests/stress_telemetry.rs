//! Empirical Telemetry Stress Testing Suite
//! Challenger R0-1: Stress-testing telemetry parsers, process tree algorithms, and concurrency.

#![allow(dead_code)]

#[path = "../src/telemetry.rs"]
mod telemetry;

use std::thread;

#[test]
fn test_stress_smaps_rollup_addition_overflow_edge_cases() {
    let input = "\
Private_Clean:     18446744073709551615 kB
Private_Dirty:     1 kB
Swap:              18446744073709551615 kB
";
    let stats = telemetry::parse_smaps_rollup_text(input);
    let res1 = std::panic::catch_unwind(|| {
        let _ = stats.private_ws_kb();
    });
    let did_panic_private_ws = res1.is_err();
    let res2 = std::panic::catch_unwind(|| {
        let _ = stats.commit_mb();
    });
    let did_panic_commit = res2.is_err();
    println!("Smaps overflow test: private_ws panic={}, commit panic={}", did_panic_private_ws, did_panic_commit);
    assert!(!did_panic_private_ws, "saturating_add must prevent panic on private_ws u64::MAX + 1 in debug mode");
    assert!(!did_panic_commit, "saturating_add must prevent panic on commit u64::MAX + 1 in debug mode");
    assert_eq!(stats.private_ws_kb(), u64::MAX);
    assert_eq!(stats.commit_kb(), u64::MAX);
}

#[test]
fn test_stress_smaps_rollup_negative_and_giant_numbers() {
    // 1. Negative numbers should be rejected by u64 parser without crashing
    let negative_input = "\
Rss:               -45280 kB
Pss:               -1 kB
Pss_Anon:          -28000 kB
Pss_File:          -4140 kB
Private_Clean:     -1240 kB
Private_Dirty:     -29800 kB
Swap:              -100 kB
";
    let stats = telemetry::parse_smaps_rollup_text(negative_input);
    assert_eq!(stats.rss_kb, 0);
    assert_eq!(stats.pss_kb, 0);
    assert_eq!(stats.private_clean_kb, 0);
    assert_eq!(stats.private_dirty_kb, 0);
    assert_eq!(stats.swap_kb, 0);

    // 2. Giant numbers exceeding u64::MAX (overflow)
    let overflow_input = "\
Rss:               999999999999999999999999999999999999999999999999999 kB
Pss:               18446744073709551616 kB
Private_Clean:     340282366920938463463374607431768211456 kB
Private_Dirty:     18446744073709551615 kB
Swap:              0 kB
";
    let stats2 = telemetry::parse_smaps_rollup_text(overflow_input);
    // Overflowing values should fail parsing safely and remain 0
    assert_eq!(stats2.rss_kb, 0);
    assert_eq!(stats2.pss_kb, 0);
    assert_eq!(stats2.private_clean_kb, 0);
    // u64::MAX exact match
    assert_eq!(stats2.private_dirty_kb, u64::MAX);
}

#[test]
fn test_stress_smaps_rollup_corrupted_headers_and_garbage() {
    let mut malformed = String::new();
    malformed.push_str("::: invalid header\n");
    malformed.push_str("Rss\n"); // missing value
    malformed.push_str("Pss: \n"); // trailing whitespace only
    malformed.push_str("Private_Dirty: abc kB\n"); // non-numeric
    malformed.push_str("Private_Clean: 123456789012345678901234567890 kB\n"); // giant
    malformed.push_str("\0\0\0 null bytes in stream\n");
    malformed.push_str("      \t\t\t   \n"); // whitespace line
    malformed.push_str("Swap: 4096 kB extra trailing tokens here\n"); // extra tokens

    let stats = telemetry::parse_smaps_rollup_text(&malformed);
    // Swap: 4096 kB should still be parsed since split_whitespace takes second token
    assert_eq!(stats.swap_kb, 4096);
    assert_eq!(stats.rss_kb, 0);
    assert_eq!(stats.pss_kb, 0);
    assert_eq!(stats.private_clean_kb, 0);
}

#[test]
fn test_stress_smaps_rollup_fuzzing_random_bytes() {
    // Generate pseudo-random strings with edge-case characters
    let chars = ["Rss:", "Pss:", "Private_Clean:", "Private_Dirty:", "Swap:", "\n", "\t", " ", "0", "9", "-", "A", "\0", "\r", ":", "kB"];
    let mut rng_state: u64 = 0x123456789abcdef0;

    for _ in 0..1000 {
        let mut sample = String::new();
        for _ in 0..30 {
            rng_state = rng_state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let idx = (rng_state as usize) % chars.len();
            sample.push_str(chars[idx]);
        }
        // Must never panic or crash
        let stats = telemetry::parse_smaps_rollup_text(&sample);
        let _ = stats.private_ws_mb();
        let _ = stats.pss_mb();
        let _ = stats.working_set_mb();
    }
}

#[test]
fn test_stress_proc_stat_adversarial_comm_and_bounds() {
    // 1. Comm with deeply nested and unmatched parentheses
    let nested = "100 ((nested (parentheses) in name)) S 1 100 100 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 50000 0";
    let info = telemetry::parse_proc_stat_text(nested).expect("Nested parens in comm should parse");
    assert_eq!(info.pid, 100);
    assert_eq!(info.comm, "(nested (parentheses) in name)");
    assert_eq!(info.ppid, 1);
    assert_eq!(info.starttime, 50000);

    // 2. Reversed parentheses
    let reversed = "100 )comm( S 1 100 100 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 50000 0";
    assert!(telemetry::parse_proc_stat_text(reversed).is_none());

    // 3. Negative PID / PPID / starttime
    let neg_pid = "-100 (test) S 1 100 100 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 50000 0";
    assert!(telemetry::parse_proc_stat_text(neg_pid).is_none());

    let neg_ppid = "100 (test) S -1 100 100 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 50000 0";
    assert!(telemetry::parse_proc_stat_text(neg_ppid).is_none());

    let neg_start = "100 (test) S 1 100 100 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 -50000 0";
    assert!(telemetry::parse_proc_stat_text(neg_start).is_none());

    // 4. Over 100 fields with trailing garbage
    let mut long_stat = "999 (long_proc) R 1 999 999 0 -1 4194304 100 0 0 0 10 20 0 0 20 0 1 0 12345 67890".to_string();
    for i in 0..100 {
        long_stat.push_str(&format!(" extra_token_{}", i));
    }
    let long_info = telemetry::parse_proc_stat_text(&long_stat).expect("Long stat line should parse correctly");
    assert_eq!(long_info.pid, 999);
    assert_eq!(long_info.starttime, 12345);
}

#[test]
fn test_stress_pid_reuse_and_cyclic_graphs() {
    // 1. Direct cyclic dependency: PID 100 -> parent 200, PID 200 -> parent 100
    let cyclic_nodes = vec![
        telemetry::ProcNode { pid: 100, parent_pid: 200, creation_time: 1000 },
        telemetry::ProcNode { pid: 200, parent_pid: 100, creation_time: 1000 },
        telemetry::ProcNode { pid: 300, parent_pid: 100, creation_time: 1100 },
    ];
    // Seed with host PID 100
    let tree = telemetry::build_process_tree_pids(&cyclic_nodes, &[100]);
    assert!(tree.contains(&100));
    assert!(tree.contains(&200));
    assert!(tree.contains(&300));

    // 2. Deep tree (depth 200) to test recursion/stack limits
    let mut deep_nodes = Vec::new();
    deep_nodes.push(telemetry::ProcNode { pid: 1, parent_pid: 0, creation_time: 1000 });
    for i in 2..=200 {
        deep_nodes.push(telemetry::ProcNode {
            pid: i,
            parent_pid: i - 1,
            creation_time: 1000 + (i as u64) * 10,
        });
    }
    let deep_tree = telemetry::build_process_tree_pids(&deep_nodes, &[1]);
    assert_eq!(deep_tree.len(), 200);

    // 3. PID reuse attack: An unrelated process reused parent PID 50, but was created EARLIER
    let mut reuse_nodes = deep_nodes.clone();
    reuse_nodes.push(telemetry::ProcNode {
        pid: 9999,
        parent_pid: 50,
        creation_time: 500, // Created BEFORE parent 50 (which was created at 1000 + 50*10 = 1500)
    });
    // And another process that was child of reused PID 9999
    reuse_nodes.push(telemetry::ProcNode {
        pid: 10000,
        parent_pid: 9999,
        creation_time: 550,
    });
    let reuse_tree = telemetry::build_process_tree_pids(&reuse_nodes, &[1]);
    assert!(!reuse_tree.contains(&9999), "Pre-dating PID reuse candidate must be rejected");
    assert!(!reuse_tree.contains(&10000), "Descendant of pre-dating candidate must be rejected");
}

#[test]
fn test_stress_concurrent_telemetry_sampling() {
    // Stress test Windows process tree memory sampling under high thread concurrency
    let handles: Vec<_> = (0..8)
        .map(|_| {
            thread::spawn(|| {
                for _ in 0..20 {
                    let bd = telemetry::sample_browser_memory_breakdown(1);
                    assert!(bd.total_private_ws_mb > 0.0);
                    assert!(bd.process_count >= 1);
                }
            })
        })
        .collect();

    for h in handles {
        h.join().expect("Concurrent telemetry sampling thread must not panic");
    }
}

#[test]
fn test_stress_select_earliest_renderer_pid_adversarial_inputs() {
    // 1. Zero timestamps: unrecorded timestamps (0) must not preempt valid timestamps
    let zero_and_valid = vec![(0, 10), (1000, 500), (0, 5)];
    assert_eq!(
        telemetry::select_earliest_renderer_pid(&zero_and_valid),
        Some(500),
        "Valid timestamp (1000) must beat unrecorded zero timestamps"
    );

    // All zero timestamps: must fallback to lowest PID deterministically
    let all_zero = vec![(0, 500), (0, 100), (0, 300), (0, 100)];
    assert_eq!(
        telemetry::select_earliest_renderer_pid(&all_zero),
        Some(100),
        "All zero timestamps must resolve to lowest PID"
    );

    // 2. Duplicate timestamps: tie-breaking by lowest PID
    let dup_timestamps = vec![(2000, 800), (2000, 200), (2000, 500)];
    assert_eq!(
        telemetry::select_earliest_renderer_pid(&dup_timestamps),
        Some(200),
        "Identical timestamps must break tie by lowest PID"
    );

    // Duplicate timestamp and duplicate PID
    let identical_cands = vec![(2000, 200), (2000, 200)];
    assert_eq!(
        telemetry::select_earliest_renderer_pid(&identical_cands),
        Some(200)
    );

    // 3. Inverted PIDs: High PID created earlier must win over lower PID created later
    let inverted = vec![(1000, 999_999), (2000, 10), (1500, 50)];
    assert_eq!(
        telemetry::select_earliest_renderer_pid(&inverted),
        Some(999_999),
        "Earlier timestamp (1000) with huge PID must win over newer low PIDs"
    );

    // 4. Wraparound PIDs: u32::MAX boundaries and simulated PID wrap
    let wraparound = vec![
        (1000, u32::MAX),
        (2000, 1),
        (1000, u32::MAX - 1),
    ];
    // Between (1000, u32::MAX) and (1000, u32::MAX - 1), earliest time is 1000, and u32::MAX - 1 is lower PID
    assert_eq!(
        telemetry::select_earliest_renderer_pid(&wraparound),
        Some(u32::MAX - 1),
        "Timestamp tie at u32 boundary must correctly order u32::MAX - 1 before u32::MAX"
    );

    // Timestamp boundary edge cases (u64::MAX and u64::MAX - 1)
    let max_timestamps = vec![
        (u64::MAX, 10),
        (0, 5),              // 0 maps to u64::MAX, so key is (u64::MAX, 5)
        (u64::MAX - 1, 100), // u64::MAX - 1 is strictly less than u64::MAX
    ];
    assert_eq!(
        telemetry::select_earliest_renderer_pid(&max_timestamps),
        Some(100),
        "u64::MAX - 1 timestamp must win over u64::MAX and 0"
    );

    // 5. Permutation Invariance Oracle Stress Test (5,000 iterations)
    let mut rng: u64 = 0xDEADBEEFCAFE;
    for _ in 0..5000 {
        rng = rng.wrapping_mul(6364136223846793005).wrapping_add(1);
        let count = ((rng % 20) + 1) as usize;
        let mut list = Vec::with_capacity(count);
        for _ in 0..count {
            rng = rng.wrapping_mul(6364136223846793005).wrapping_add(1);
            let time = match rng % 5 {
                0 => 0,
                1 => u64::MAX,
                2 => u64::MAX - 1,
                _ => rng % 10_000,
            };
            rng = rng.wrapping_mul(6364136223846793005).wrapping_add(1);
            let pid = match rng % 4 {
                0 => u32::MAX,
                1 => u32::MAX - 1,
                2 => (rng % 100) as u32,
                _ => (rng % 100_000) as u32,
            };
            list.push((time, pid));
        }

        // Oracle calculation:
        let mut expected = None;
        let mut min_key = (u64::MAX, u32::MAX);
        for &(t, p) in &list {
            let eff_t = if t > 0 { t } else { u64::MAX };
            let key = (eff_t, p);
            if expected.is_none() || key < min_key {
                min_key = key;
                expected = Some(p);
            }
        }

        let actual = telemetry::select_earliest_renderer_pid(&list);
        assert_eq!(
            actual, expected,
            "Adversarial candidate list {:?} produced {:?}, expected {:?}",
            list, actual, expected
        );
    }
}

