# Codebase Audit

## Project Map
- Monorepo: Bun workspaces + Turbo at the root (`package.json`, `turbo.json`, `bun.lock`).
- Frontend: `apps/web` uses React 19, React Router 7, Vite 5, TypeScript.
- Backend: `apps/backend` uses Cloudflare Workers, Hono, D1, and R2 via Wrangler 4.
- Shared domain logic: `packages/engine` contains Pokemon TCG rules/helpers consumed by the web app.
- Docs/data: `knowledge/` contains gameplay references; `resources/` and `apps/backend/data/` contain source material and seed data.

## Executive Summary
This repo is structurally sound: strict TypeScript is enabled, the monorepo boundaries are clear, and the shared engine package is a sensible split. The main quality issues were in operational reliability rather than catastrophic security defects: root scripts were not runnable from the workspace, simulator startup and undo behavior had correctness problems, and the web build emitted CSS nesting warnings. I fixed the high-signal issues that were safe to change without altering public APIs or trampling existing user edits. The main remaining risks are deployment readiness in Wrangler config, `cards.ts` type/performance debt on the backend hot path, and simulator actions that still log manual effect text instead of resolving effects.

## Findings

### Fixed
- [MEDIUM] Dependencies & Configuration — `apps/backend/package.json:5`, `apps/web/package.json:6`, `packages/engine/package.json:8` — workspace scripts depended on bare `wrangler`, `vite`, and `tsc` binaries and failed from the root.
- [HIGH] Correctness & Bugs — `apps/web/src/pages/SimulatorPage.tsx:36` — simulator bootstrap could reject without a catch path, causing noisy startup failures and skipped auto-setup.
- [MEDIUM] Correctness & Bugs — `apps/web/src/pages/BrowsePage.tsx:87` — metadata loading used all-or-nothing `Promise.all`, so one endpoint failure blanked all browse metadata.
- [MEDIUM] Correctness & Bugs — `apps/web/src/pages/simulator/useSimulatorState.ts:68` — undo history recorded no-op actions, polluting time travel and wasting memory.
- [MEDIUM] Correctness & Bugs — `apps/backend/src/routes/cards.ts:244` — card pagination sorted by non-unique `name` only, which can duplicate or skip rows across pages.
- [MEDIUM] Type Safety — `apps/web/src/lib/api.ts:41` — API client accepted shallow payloads with weak runtime validation.
- [LOW] Readability & Maintainability — `apps/web/src/styles/browse.css:1`, `apps/web/src/styles/filters.css:1` — Sass-style nesting emitted production build warnings under native CSS nesting rules.
- [LOW] Readability & Maintainability — `apps/web/src/components/filter-sidebar.tsx:148`, `apps/web/src/components/filter-sidebar-sections.tsx:112` — UI buttons relied on implicit button type behavior.

### Remaining
- [HIGH] Dependencies & Configuration — `apps/backend/wrangler.jsonc:11` — `database_id` is still the placeholder `REPLACE_WITH_YOUR_DATABASE_ID`, so real deploys are not production-ready.
- [MEDIUM] Type Safety — `apps/backend/src/routes/cards.ts:42`, `apps/backend/src/routes/cards.ts:56`, `apps/backend/src/routes/cards.ts:251`, `apps/backend/src/routes/cards.ts:261` — `any`-heavy row assembly and `SELECT *` usage keep the hottest API route brittle and overfetch more than needed.
- [MEDIUM] Correctness & Bugs — `apps/web/src/pages/simulator/useSimulatorActions.ts:475` — abilities only log their effect text and mark usage; they do not execute engine-level effects.
- [MEDIUM] Correctness & Bugs — `apps/web/src/pages/simulator/useSimulatorActions.ts:502` — trainer card effects are still manual/log-only for most cards, so simulator state can drift from card text.
- [LOW] Readability & Maintainability — `README.md:1` — the root README is effectively empty, which raises onboarding and ops cost.

## Prioritized Action Plan
```text
[HIGH] Config — apps/backend/wrangler.jsonc:11 — Replace the placeholder D1 database_id before any real deployment.
[MEDIUM] Bug — apps/web/src/pages/simulator/useSimulatorActions.ts:475 — Route ability usage through engine effect resolution instead of log-only behavior.
[MEDIUM] Bug — apps/web/src/pages/simulator/useSimulatorActions.ts:502 — Implement trainer effect execution or explicitly gate unsupported cards in the simulator UI.
[MEDIUM] Type Safety — apps/backend/src/routes/cards.ts:42 — Replace `any` row handling with typed row shapes and explicit child-table selects.
[LOW] Docs — README.md:1 — Add setup, dev, build, and deployment instructions at the repo root.
```

## Changes Made

### Dependencies & Configuration
- `apps/backend/package.json`: switched Wrangler commands to `bunx` and redirected `XDG_CONFIG_HOME` into the workspace so root builds work in this environment.
- `apps/web/package.json`: switched Vite commands to `bunx`.
- `packages/engine/package.json`: switched TypeScript invocation to `bunx`.

### Correctness & Reliability
- `apps/web/src/pages/SimulatorPage.tsx`: added cancellation-aware bootstrap error handling around `fetchDecks()` + `autoSetup()`.
- `apps/web/src/pages/BrowsePage.tsx`: changed metadata loading to `Promise.allSettled()` so partial metadata failures degrade gracefully.
- `apps/web/src/pages/simulator/useSimulatorState.ts`: only push undo history when the cloned store actually changed.
- `apps/backend/src/routes/cards.ts`: made list pagination stable with `ORDER BY c.name ASC, c.id ASC`.

### Type Safety
- `apps/web/src/lib/api.ts`: tightened response guards for filters, sets, decks, and card detail payloads.

### Maintainability & UX
- `apps/web/src/styles/browse.css`: flattened invalid nested selectors to valid native CSS.
- `apps/web/src/styles/filters.css`: flattened invalid nested selectors that were causing Vite build warnings.
- `apps/web/src/components/filter-sidebar.tsx`: added explicit `type="button"` to action buttons.
- `apps/web/src/components/filter-sidebar-sections.tsx`: added explicit `type="button"` to set selection controls.

## Remaining Issues
- `apps/backend/wrangler.jsonc:11`: deployment is still blocked until a real D1 database ID is configured.
- `apps/backend/src/routes/cards.ts`: the card browse endpoint still needs a typed DTO pass and narrower SQL selects.
- `apps/web/src/pages/simulator/useSimulatorActions.ts`: simulator ability/trainer resolution is still incomplete for many card effects.
- `README.md:1`: repository-level docs still need to be written.

## Recommendations
- Add CI for `bun run typecheck` and `bun run build` at the repo root now that both commands execute cleanly.
- Move backend response shaping toward shared schemas or typed DTOs so frontend/runtime guards and backend payloads stay aligned.
- Treat unsupported simulator card effects explicitly: either implement them through `@luminous/engine` or mark them unsupported in the UI instead of silently logging text.
- Fill out the root README with prerequisites, local env setup, D1/R2/Wrangler configuration, and common workflows.
