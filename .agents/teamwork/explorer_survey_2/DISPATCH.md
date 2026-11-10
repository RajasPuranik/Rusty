## Task: Frontend UI, Skins & WebGL Survey

### Working Directory
`d:\browser\.agents\teamwork\explorer_survey_2\`

### Reference Documents
- `d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md` (Read this first and completely!)

### Objectives
1. Map the existing frontend codebase in `d:\browser\ui` (and any related UI directories):
   - Inspect HTML, CSS, JavaScript files, assets, and styling architecture.
   - Inspect existing skins (Crazy, Minimal, and any others) and verify how skins are switched / loaded.
   - Inspect mock bridge implementation (`mock-bridge.html` or similar preview runner) and test if it runs without console errors.
   - Inspect current WebGL / canvas usage, particularly the existing globe implementation and performance characteristics.
   - Inspect current IPC invocation from JavaScript (`rusty://app/` protocol or window.__TAO_IPC__).
2. Identify design and implementation requirements for:
   - R5: Softer Dark skin (muted palettes, 1px low-contrast borders, double shadows, 1.5px search outline) & Mayank White skin (floating pill address bar, neumorphic surfaces, wind lines at 30 fps, weather orb).
   - R6: Modular background registry (mount/pause/resume/destroy, 30 fps cap, 10 fps idle freeze, single WebGL context) & Night globe upgrade (R8 4096x2048 texture, twilight shader, size increase).
   - R7: Customizable launch cards (reordering, local app execution, presets).
3. Produce a structured analysis report in `survey_frontend.md` and complete handoff in `handoff.md`.


## 2026-11-09T17:31:05Z
You are Explorer 2 (Frontend UI, Skins & WebGL Explorer).
Your working directory is d:\browser\.agents\teamwork\explorer_survey_2\
Read your dispatch instructions at d:\browser\.agents\teamwork\explorer_survey_2\DISPATCH.md.
MANDATORY: You MUST read the authoritative user request at d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md before beginning.

Your task is to conduct an in-depth survey of the UI frontend in d:\browser\ui (and any related files):
1. Map all HTML, CSS, JavaScript files, assets, and styling architecture.
2. Inspect the mock bridge preview runner (mock-bridge.html / bridge.js or similar). Check how it works and whether it runs cleanly without console errors.
3. Inspect how skins are defined and loaded. Verify the invariant: "Only the active skin's code loads into memory."
4. Inspect the WebGL canvas, 3D globe, shaders, and rendering loop. Check frame rate capping, texture sizes, and performance metrics.
5. Survey requirements and architecture needed for:
   - R5: Softer Dark skin (muted palettes, 1px low-contrast borders, double shadows, 1.5px search outline) & Mayank White skin (floating pill address bar, neumorphic surfaces, wind lines at 30 fps, weather orb).
   - R6: Interactive modular background registry (lazy-loaded modules, mount/pause/resume/destroy lifecycle, eco rules: 30 fps cap, 10 fps idle freeze, single WebGL context) & Night globe upgrade (R8 4096x2048 texture, twilight shader, size increase).
   - R7: Customizable launch cards (reordering, local app execution, JSON import/export, presets).
6. Write your comprehensive findings to d:\browser\.agents\teamwork\explorer_survey_2\survey_frontend.md.
7. Write your self-contained handoff to d:\browser\.agents\teamwork\explorer_survey_2\handoff.md following the Handoff Protocol (Observation, Logic Chain, Caveats, Conclusion, Verification).
8. Send a completion message to the caller with your findings and file paths.
