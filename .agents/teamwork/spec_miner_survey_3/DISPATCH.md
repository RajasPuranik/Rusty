## Task: Requirements Specification & Dependency Mining Survey

### Working Directory
`d:\browser\.agents\teamwork\spec_miner_survey_3\`

### Reference Documents
- `d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md` (Read this first and completely!)

### Objectives
1. Deeply mine and enumerate all functional and non-functional requirements from `ORIGINAL_REQUEST.md`:
   - Enumerate all milestones R0 through R9 with fine-grained feature breakdowns.
   - For each milestone, identify: inputs, outputs, platform APIs required (Windows WebView2 vs Linux WebKitGTK), constraints, invariants, dependencies on prior milestones.
   - Map out acceptance criteria, performance guardrails (RAM limits: 60MB minimal UI, 120MB Crazy/Mayank UI, 15% less than Chrome for 10 tabs), testing criteria (unit, integration, E2E, CI workflows).
   - Identify external resources, placeholders, asset requirements (NASA public domain texture, letter avatars, etc.).
   - Define exact interface contracts needed between Rust core and platform layer, between Rust core and UI webview, between workspaces and focus mode/YouTube filters, between launch cards and local execution.
2. Produce a comprehensive requirement and specification breakdown in `survey_spec.md` and complete handoff in `handoff.md`.


## 2026-11-09T17:31:29Z
You are Explorer 3 (Requirements Specification & Dependency Miner).
Your working directory is d:\browser\.agents\teamwork\spec_miner_survey_3\
Read your dispatch instructions at d:\browser\.agents\teamwork\spec_miner_survey_3\DISPATCH.md.
MANDATORY: You MUST read the authoritative user request at d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md before beginning.

Your task is to thoroughly analyze the specifications, constraints, and dependencies across all milestones R0 through R9:
1. Break down all milestones R0 to R9 into explicit functional features, data models, and non-functional constraints.
2. For each milestone, enumerate:
   - Specific platform API requirements (WebView2 raw COM interfaces vs WebKitGTK 4.1 C/Rust bindings).
   - Invariants that apply to the milestone.
   - Core dependencies on earlier milestones.
   - Exact acceptance criteria and verification methods (e.g. benchmark scripts, RAM measurement reconciliation, CI test targets).
3. Detail specific requirements for:
   - R0: Process tree metrics (browser, renderer, GPU, utility, UI webview, Rust shell), platform trait methods.
   - R4: Focus modes, category blocking, YouTube study filters (DOM selectors, category extraction from playerMicroformatRenderer, redirect /shorts/, study home).
   - R8: WebView2 extension APIs (AreBrowserExtensionsEnabled, AddBrowserExtension), Linux WebKitGTK userscripts via UserContentManager.
   - R9: Deliverables, threat model updates, documentation of external snippets/PLACEHOLDER assets.
4. Write your comprehensive analysis to d:\browser\.agents\teamwork\spec_miner_survey_3\survey_spec.md.
5. Write your self-contained handoff to d:\browser\.agents\teamwork\spec_miner_survey_3\handoff.md following the Handoff Protocol (Observation, Logic Chain, Caveats, Conclusion, Verification).
6. Send a completion message to the caller with your findings and file paths.
