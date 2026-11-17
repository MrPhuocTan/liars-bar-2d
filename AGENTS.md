# Workspace Rules — Liar's Bar 2D (Online Web Version)

System prompt for every project: /Users/mrtun/Documents/Freelance/System Instruction Prompts

## 1. Project Overview & Primary Domains
- **Purpose:** 2D Pixel Art Online Web Version of *Liar's Bar (Liar's Deck / Bài Nói Dối)* featuring the 20-card bluffing deck, Empty-Hand Win condition (`Đánh Hết Bài Là Thắng`) + 6-chamber Russian Roulette revolver (`1/6 -> 6/6`), tactical AI bots, and 8-bit WebAudio.
- **Primary Domain(s):** `Domain 1: IT and Software Engineering`, `Domain 8: Design and Creative`, `Domain 5: Business and Product Management`
- **Shared State Path (`Level 2`–`Level 4` only):** `./agent_communicate.md`

## 2. Architecture & Key Entrypoints
- **Core Entrypoints:** `server.js` (HTTP server + REST API), `src/engine/gameEngine.js` (deterministic state machine), `src/engine/aiBot.js` (tactical AI), `public/index.html` & `public/js/app.js` (2D Pixel Art Web Client).
- **Data / Config Locations:** `docs/LIARS_BAR_RESEARCH_AND_DESIGN.md`, `tests/engine.test.js`, `tests/e2e_qa_verify.mjs`.

## 3. Local Build, Run & Verification Commands
- **Install / Environment:** Native Node.js (`>= 18`, zero external npm install required).
- **Automated Test Suite:** `npm test` (`node --test tests/engine.test.js`)
- **Application / Runtime Launch:** `npm start` (`node server.js`, defaults to `http://127.0.0.1:3000`)

## 4. Project-Specific Constraints & Non-Negotiables
- Preserve `image-rendering: pixelated` 2D pixel art clarity across Desktop (`1440x900`), Tablet (`768x1024`), and Mobile (`375x812`).
- Use generic personal project branding (`Liar's Bar 2D — Online Web Version` / `2D Pixel Edition`) with zero third-party portal names, zero decorative "AI Sign" badges, and zero leaked secrets/tokens in git config or repository files.
- Enforce deterministic `FINAL_CHALLENGE_WINDOW` when a player empties their hand in `EMPTY_HAND_WIN` mode.
