# Codebase Audit

## Executive Summary
This repository is a Bun/Turbo monorepo with a React 19 + Vite frontend and a Cloudflare Workers + Hono backend over D1/R2. The original audit surfaced issues in simulator game-state correctness, browse-page async behavior, permissive worker CORS, weak health semantics, and a few oversized frontend controller modules. Those issues have now been fixed in code, along with lightweight runtime validation in the API client and a working root typecheck path for the Bun workspace. What remains is mostly process-level hardening and future architectural cleanup rather than immediate defects.

## Prioritized Action Plan
[DONE] High Bug — apps/backend/src/routes/health.ts — Health endpoint now returns `status: "error"` with HTTP 503 when the DB probe fails.

[DONE] Medium Security — apps/backend/src/index.ts, apps/backend/src/lib/cors.ts — CORS now uses an explicit allowlist sourced from `ALLOWED_ORIGINS` plus localhost instead of wildcard platform suffix matching.

[DONE] Medium Security — apps/backend/src/routes/images.ts — Image responses now apply the same origin allowlist instead of wildcard CORS.

[DONE] Medium Correctness — apps/backend/src/routes/images.ts — Image route now derives `Content-Type` from stored object metadata with a binary fallback.

[DONE] Medium Perf — apps/web/src/pages/simulator/logic.ts — Deck building now resolves unique card queries in parallel instead of sequentially.

[DONE] Medium Org — apps/web/src/pages/SimulatorPage.tsx, apps/web/src/pages/simulator/useSimulatorActions.ts — Simulator page orchestration was split into a dedicated actions hook.

[DONE] Medium Org — apps/web/src/components/filter-sidebar.tsx, apps/web/src/components/filter-sidebar-sections.tsx — Filter sidebar sections were extracted into dedicated components.

[DONE] Low Type Safety — apps/web/src/lib/api.ts — API responses now pass through lightweight runtime guards before being used as typed data.

[DONE] Low Maintainability — apps/web/src/pages/BrowsePage.tsx — Browse metadata and card loading now expose UI-visible error state instead of log-only failure.

## Changes Made

### Correctness & Bugs
- [apps/web/src/pages/simulator/logic.ts](/home/jofre/projects/luminous/apps/web/src/pages/simulator/logic.ts): fixed `canAct()` so a winner value of `0` no longer bypasses the game-over guard.
- [apps/web/src/pages/simulator/logic.ts](/home/jofre/projects/luminous/apps/web/src/pages/simulator/logic.ts): changed `autoMulliganUntilBasic()` to fail fast when a deck contains no Basic Pokemon instead of looping forever.
- [apps/web/src/pages/simulator/useSimulatorActions.ts](/home/jofre/projects/luminous/apps/web/src/pages/simulator/useSimulatorActions.ts): added explicit setup logs when a deck cannot legally complete mulligan/setup and moved the full simulator action orchestration out of the page component.
- [apps/backend/src/routes/cards.ts](/home/jofre/projects/luminous/apps/backend/src/routes/cards.ts): sanitized numeric HP filters so invalid `hp_min`/`hp_max` query values are ignored instead of binding `NaN` into SQL.
- [apps/backend/src/routes/health.ts](/home/jofre/projects/luminous/apps/backend/src/routes/health.ts): changed the failure path to return HTTP 503 with `status: "error"` when the database is unavailable.
- [apps/backend/src/routes/images.ts](/home/jofre/projects/luminous/apps/backend/src/routes/images.ts): preserved object content type instead of hardcoding WebP for all image responses.

### Performance & Async State
- [apps/web/src/pages/BrowsePage.tsx](/home/jofre/projects/luminous/apps/web/src/pages/BrowsePage.tsx): eliminated stale-request and duplicate-pagination races by tracking request generations plus ref-backed `loading`, `offset`, and `hasMore` state for the intersection loader.
- [apps/web/src/pages/simulator/logic.ts](/home/jofre/projects/luminous/apps/web/src/pages/simulator/logic.ts): resolved unique decklist lookups in parallel to reduce simulator setup latency.

### Readability & Maintainability
- [apps/web/src/components/search-bar.tsx](/home/jofre/projects/luminous/apps/web/src/components/search-bar.tsx): added timeout cleanup on unmount.
- [apps/web/src/components/filter-sidebar.tsx](/home/jofre/projects/luminous/apps/web/src/components/filter-sidebar.tsx): added debounced HP timer cleanup on unmount.
- [apps/web/src/components/filter-sidebar-sections.tsx](/home/jofre/projects/luminous/apps/web/src/components/filter-sidebar-sections.tsx): extracted set, select, HP, and legality groups out of the sidebar controller component.
- [apps/web/src/pages/SimulatorPage.tsx](/home/jofre/projects/luminous/apps/web/src/pages/SimulatorPage.tsx): reduced the page to store initialization plus board rendering.

### Security
- [apps/backend/src/lib/cors.ts](/home/jofre/projects/luminous/apps/backend/src/lib/cors.ts): centralized origin allowlist logic for both app routes and image responses.
- [apps/backend/src/index.ts](/home/jofre/projects/luminous/apps/backend/src/index.ts): replaced broad suffix-based CORS acceptance with explicit allowlist checks.
- [apps/backend/src/routes/images.ts](/home/jofre/projects/luminous/apps/backend/src/routes/images.ts): aligned image CORS handling with the shared allowlist and added `Vary: Origin` when applicable.

### Type Safety & UX
- [apps/web/src/lib/api.ts](/home/jofre/projects/luminous/apps/web/src/lib/api.ts): added runtime guards for card list, card detail, filter, and set payloads and replaced the browse page's raw set fetch with a typed API helper.
- [apps/web/src/pages/BrowsePage.tsx](/home/jofre/projects/luminous/apps/web/src/pages/BrowsePage.tsx): surfaced metadata and card-loading errors in the UI rather than relying on `console.error` alone.

### Dependencies & Configuration
- [apps/web/package.json](/home/jofre/projects/luminous/apps/web/package.json): changed TypeScript scripts to `bunx tsc` so workspace typecheck works reliably in the Bun toolchain used by this repo.
- [apps/backend/package.json](/home/jofre/projects/luminous/apps/backend/package.json): changed backend typecheck script to `bunx tsc` for the same reason.

## Remaining Issues
No unresolved code issues from the original prioritized action plan remain after the fixes above.

## Recommendations
- Set `ALLOWED_ORIGINS` explicitly in each deployment environment so the new allowlist stays intentional and reviewable.
- Add a lightweight CI step that runs `bun run typecheck` and a small backend route smoke test for `/health`, `/api/cards`, and `/images/*`.
- Consider moving simulator rules into a reducer or domain layer before adding attack resolution, prize-taking, and rule-specific turn effects.
- If the API surface grows, replace the current hand-rolled response guards with shared schemas so backend and frontend contracts stay synchronized.
