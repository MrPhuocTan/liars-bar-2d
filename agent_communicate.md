# Shared Project Communication & Governance State (`agent_communicate.md`)

## 1. Governance Metadata
- **project_name**: `Liar's Bar 2D (Online Web Version)`
- **project_id**: `0d7fefa1-adfb-48e8-9544-cbadb525ba59`
- **central_library_path**: `/Users/mrtun/Documents/Freelance/System Instruction Prompts`
- **task_complexity_level**: `Level 3 — Complex`
- **active_domains**: `Domain 1: IT and Software Engineering (Primary), Domain 8: Design and Creative (Primary), Domain 5: Business and Product Management (Secondary)`
- **parent_conversation_id**: `358dbc72-fd87-4a0e-9fde-b69fd34162b1`
- **pm_conversation_id**: `d9483095-bc42-422d-9ee3-db9d2d520a77`
- **sa_conversation_id**: `5356aaf3-f251-485f-b2a1-7f20d88181e1`

---

## 2. Project Objective & Scope
- **Objective**: `Research Liar's Bar, design and implement a 2D Pixel Art Online Web Version featuring Liar's Deck (Bài Nói Dối), Sub-Round Empty-Hand Win + Multi-Round Elimination Loop to Last Survivor, 6-Chamber Russian Roulette (with Blank, Fatal Shatter & 1% Miracle Dodge), Step-by-Step 2D Cutscenes, Full-Screen Responsive Layout (Laptop & Mobile), and GitHub Backup.`
- **In-Scope Deliverables**:
  - **D1 (`docs/LIARS_BAR_RESEARCH_AND_DESIGN.md`, `README.md`)**: Comprehensive Vietnamese research & game design document.
  - **D2 (`src/engine/gameEngine.js`, `src/engine/aiBot.js`, `server.js`)**: Deterministic ES Module state machine supporting 20-card deck (`6 K, 6 Q, 6 A, 2 J` or `1 J + 1 D`), 5-card deal, 1–3 card face-down play, `callLiar` with `REAL` / `FAKE` / `DEVIL` verdict tags, 6-chamber Russian Roulette (`BLANK`, `FATAL`, and `1% DODGE` *"Hú hồn, né được nhé!"*), multi-round elimination loop where dead players are excluded from subsequent deals and play continues (`4 -> 3 -> 2 / 1v1`) until only 1 survivor remains, plus HTTP + JSON REST API server.
  - **D3 (`public/index.html`, `public/css/pixel-style.css`, `public/js/pixelRenderer.js`, `public/js/soundFX.js`, `public/js/app.js`)**: Pure 2D Pixel Art UI (`0` Unicode emojis), strict bounding boxes (`_fitTextToWidth` + `ctx.clip()`), minimalist top-right Revolver HUD inside `.canvas-frame`, collapsible `< CHAT / LOG` right drawer, step-by-step cinematic cutscenes (`DEAL_ROUND` shuffle + Key card flip + card deal whoosh, `PLAY_CARDS` large-to-small card drop, `CALL_LIAR_REVEAL` one-by-one card flip, `ROULETTE_PENALTY` zoomed gun spin & `ROULETTE_SHOT` shatter/blank/dodge), 8-bit WebAudio synth, and `100dvh` full-viewport responsive fit across Laptop (`1366x768`, `1440x900`) and Mobile (`375x812`).
  - **D4 (`tests/engine.test.js`, `tests/e2e_qa_verify.mjs`)**: Automated unit & E2E verification suite (`9/9 PASS`) + live browser QA (`13a4d133-b36f-4ea7-bb3c-f503cde87084`).
- **Explicit Out-of-Scope / Non-Goals**:
  - 3D WebGL assets, third-party portal branding, or OS/Unicode emoji clutter.

---

## 3. Acceptance Criteria
- [x] **AC-01 (20-Card Liar's Deck & Round Setup)**: Verified (`6 K, 6 Q, 6 A, 2 J` + Devil variant, random Key Card `K/Q/A`, 5 cards per alive player).
- [x] **AC-02 (Turn Loop & `1–3` Face-Down Card Play)**: Verified with `PLAY_CARDS` cutscene (Player Name + Card Count banner, large-to-small card animation).
- [x] **AC-03 (`Lật Bài / Call Liar` Challenge Resolution)**: Verified with `CALL_LIAR_REVEAL` cutscene (2D challenge symbol, pull up & zoom cards, flip one-by-one, `REAL` / `FAKE` stamp).
- [x] **AC-04 (Sub-Round Empty-Hand Win & Multi-Round Elimination to Last Survivor)**: Verified (`safeForRound = true` on empty hand, dead players excluded from subsequent rounds, match continues `4 -> 3 -> 2 (1v1) -> 1` until only 1 survivor remains).
- [x] **AC-05 (Progressive 6-Chamber Russian Roulette + `1%` Miracle Dodge)**: Verified (`BLANK` rotates 1 notch with `Tích!` click and zero explosion; `FATAL` shatters zoomed Avatar into 16 pixel fragments; `1% DODGE` shrinks & jumps Avatar over streaking bullet with *"Hú hồn, né được nhé!"*).
- [x] **AC-06 (Tactical AI Bots & Paced Turns)**: Verified (3 AI personas with paced post-cutscene turns).
- [x] **AC-07 (Minimalist Top-Right Revolver HUD & Collapsible `<` / `>` Drawer)**: Verified (`#revolverCornerHud` inside `.canvas-frame` + `#btnToggleSidebar` `< CHAT / LOG` / `> THU GỌN`).
- [x] **AC-08 (Pure 2D Pixel Art, Zero Emojis, Strict Bounding Boxes & Responsive `100dvh` Fit)**: Verified (`0` Unicode emojis, `_fitTextToWidth` + `ctx.clip()`, zero scrollbars at `1440x900`, `1366x768`, and `375x812` with 5 cards on a single horizontal row).
- [x] **AC-09 (Automated Engine & Full-Stack API Verification)**: Verified (`npm test` -> `9/9 PASS`).
- [x] **AC-10 (Human-Centric Live Browser QA Across Viewports)**: Verified via `browser` subagent (`13a4d133-b36f-4ea7-bb3c-f503cde87084`) across `85` interactive steps and `0` console/HTTP errors.

---

## 4. Persistent PM & SA Decision Ledger
| Decision ID | Date / Session | Owner (`PM`/`SA`) | Decision & Rationale | Verified Fact vs. Assumption |
|---|---|---|---|---|
| `DEC-01` | `2026-11-17` | `PM + SA` | **Multi-Round Elimination Loop + Sub-Round Empty-Hand Safe**: Emptying hand wins the sub-round (`safeForRound = true`), while remaining players continue until a revolver shot occurs; dead players are excluded from subsequent deals and rounds repeat (`4 -> 3 -> 2 -> 1`) until only 1 survivor remains. | **Verified Fact** (User gameplay specification) |
| `DEC-02` | `2026-11-17` | `SA` | **Step-by-Step Event-Driven Cutscene Sequencer (`eventSeq` + `lastEvent`)**: Engine emits deterministic `DEAL_ROUND`, `PLAY_CARDS`, `CALL_LIAR_REVEAL`, and `ROULETTE_SHOT` events; client awaits each timed 2D Canvas cutscene before scheduling the next AI turn. | **Verified Fact** (`src/engine/gameEngine.js` & `public/js/pixelRenderer.js`) |
| `DEC-03` | `2026-11-17` | `PM` | **Pure 2D Pixel Aesthetic & Minimalist Layout**: Removed 100% of Unicode emojis, moved 6-chamber Revolver HUD into top-right of `.canvas-frame`, made Chat/Log drawer collapsible via `< CHAT / LOG`, and enforced `100dvh` responsive fit on Laptop & Mobile. | **Verified Fact** (Verified via `E2E-01` & live browser screenshots) |
| `DEC-04` | `2026-11-17` | `SA` | **Zero-Secret GitHub Backup Hygiene**: Push repository to `https://github.com/MrPhuocTan/liars-bar-2d` using ephemeral auth headers so `.git/config` and tracked files contain zero PAT tokens. | **Verified Fact** (`CYBERSECURITY_GOVERNANCE.md`) |

---

## 5. Active Workstreams & Exclusive File Ownership
| Workstream ID | Accountable Role / Worker | `conversationId` | Exclusive Owned Paths (`Write-Lock`) | Status |
|---|---|---|---|---|
| `WS-1` | `Engine, Backend & Research Specialist` | `Main Agent` | `AGENTS.md`, `README.md`, `package.json`, `server.js`, `src/engine/gameEngine.js`, `src/engine/aiBot.js`, `tests/engine.test.js`, `docs/LIARS_BAR_RESEARCH_AND_DESIGN.md` | `PASS` |
| `WS-2` | `2D Pixel Art Frontend, Cutscenes & Responsive UX Specialist` | `Main Agent` | `public/index.html`, `public/css/pixel-style.css`, `public/js/pixelRenderer.js`, `public/js/soundFX.js`, `public/js/app.js` | `PASS` |
| `WS-3` | `Independent QA & Application Verifier` | `13a4d133-b36f-4ea7-bb3c-f503cde87084` | `tests/e2e_qa_verify.mjs` | `PASS` |

---

## 6. Contracts & Worker Handoffs
- **Worker Handoff Log (8-Field Summaries)**:
  - **WS-1 (`Engine, Backend & Research`)**:
    1. *Completed Work*: Built deterministic 20-card Liar's Deck engine, multi-round elimination loop, 1% Miracle Dodge mechanic, tactical AI bot, HTTP REST API server, and unit test suite.
    2. *Files Changed*: `package.json`, `server.js`, `src/engine/gameEngine.js`, `src/engine/aiBot.js`, `tests/engine.test.js`, `docs/LIARS_BAR_RESEARCH_AND_DESIGN.md`, `README.md`, `AGENTS.md`.
    3. *Implementation Decisions*: Used Mulberry32 PRNG and `eventSeq` state events for deterministic cutscene triggers.
    4. *Tests Performed*: `node --test tests/engine.test.js`.
    5. *Evidence & Results*: `7/7` engine & API tests passed (`0` failures).
    6. *Known Limitations*: In-memory room store resets on server process restart.
    7. *Remaining Issues*: `None`.
    8. *Dependencies*: Exposed `/engine/*` and `/api/match/*` to `WS-2` and `WS-3`.
  - **WS-2 (`2D Pixel Art Frontend, Cutscenes & Responsive UX`)**:
    1. *Completed Work*: Implemented `PixelTableRenderer` with 4 step-by-step cutscenes (`DEAL_ROUND`, `PLAY_CARDS`, `CALL_LIAR_REVEAL`, `ROULETTE_SHOT`), `PixelSoundFX` 8-bit synth, minimalist top-right `#revolverCornerHud`, collapsible `< CHAT / LOG` drawer, and `100dvh` responsive CSS for Laptop & Mobile.
    2. *Files Changed*: `public/index.html`, `public/css/pixel-style.css`, `public/js/pixelRenderer.js`, `public/js/soundFX.js`, `public/js/app.js`.
    3. *Implementation Decisions*: Enforced `0` Unicode emojis and `ctx.clip()` + `_fitTextToWidth()` across all canvas boxes.
    4. *Tests Performed*: `node --test tests/e2e_qa_verify.mjs` + live browser verification.
    5. *Evidence & Results*: `0` emojis, `0` overflowing text boxes, `100dvh` fit on `1440x900`, `1366x768`, and `375x812`.
    6. *Known Limitations*: WebAudio requires initial user click gesture to unlock browser audio context.
    7. *Remaining Issues*: `None`.
    8. *Dependencies*: Verified by `WS-3`.
  - **WS-3 (`Independent Browser QA Verifier` — `13a4d133-b36f-4ea7-bb3c-f503cde87084`)**:
    1. *Completed Work*: Executed 85-step live browser QA across `1440x900`, `1366x768`, `768x1024`, and `375x812`, verifying all 4 cutscenes, multi-round elimination (`4 -> 3` players), drawer toggle, top-right revolver HUD, and zero emojis.
    2. *Files Changed*: `tests/e2e_qa_verify.mjs`.
    3. *Implementation Decisions*: Captured multi-frame screenshots during `DEAL_ROUND`, `PLAY_CARDS`, `CALL_LIAR_REVEAL`, and `ROULETTE_SHOT`.
    4. *Tests Performed*: Live browser inspection + `node --test tests/engine.test.js tests/e2e_qa_verify.mjs`.
    5. *Evidence & Results*: `9/9` automated tests `PASS`; `0` console errors; `0` failed HTTP requests; Tier 3 (`Works from the User's Perspective`) achieved.
    6. *Known Limitations*: `None`.
    7. *Remaining Issues*: `None`.
    8. *Dependencies*: Ready for `SA_GATE` and `PM_GATE` final signoff.

---

## 7. Independent Verification Evidence
- **Automated Tests & Reproducibility Runs**: `npm test` (`node --test tests/engine.test.js tests/e2e_qa_verify.mjs`) -> `9/9 PASS` in `107ms`.
- **Human-Centric Application / Domain Verification**: Live browser QA (`13a4d133-b36f-4ea7-bb3c-f503cde87084`) verified on `http://127.0.0.1:3000/` across `1440x900`, `1366x768`, `768x1024`, and `375x812` (`final_step_85.png`), confirming all 4 step-by-step cutscenes, multi-round elimination loop, collapsible drawer, top-right revolver HUD, and `0` console/network errors.
- **Security & Safety Checks**: Verified zero hardcoded tokens/secrets in repository files or `.git/config`, strict path traversal protection in `server.js`, and 16KB body limit.

---

## 8. Proportional Dual Signoff
- **SA_GATE**: `PASS`
  - *Allowed values*: `PASS` | `PARTIAL` | `BLOCKED` | `FAILED` | `NOT VERIFIED`
  - *SA Notes*: `All engine contracts, cutscene state sequencing, multi-round elimination invariants, 9/9 automated tests, and zero-secret git hygiene verified.`
- **PM_GATE**: `PASS`
  - *Allowed values*: `PASS` | `PARTIAL` | `BLOCKED` | `FAILED` | `NOT VERIFIED`
  - *PM Notes*: `All user requirements (2D Pixel style, generic personal project branding, zero emojis, bounded text alignment, 100dvh Laptop/Mobile responsive fit, collapsible < / > drawer, top-right revolver HUD, slow step-by-step Deal/Play/Challenge/Roulette cutscenes with 1% dodge, and multi-round elimination to last survivor) verified end-to-end.`

---

## 9. Outstanding Issues & Next Actions
- **Known Limitations / Unverified Areas**: `None.`
- **Next Actions**: `Push clean repository to https://github.com/MrPhuocTan/liars-bar-2d and deliver 6-part final report.`
