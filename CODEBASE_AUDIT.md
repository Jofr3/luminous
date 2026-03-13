# Codebase Audit

## Executive Summary

This repository is a Bun/Turbo monorepo with three substantive parts: a Cloudflare Worker API in `apps/backend`, a React/Vite frontend in `apps/web`, and a shared TCG rules engine in `packages/engine`. The backend is small and readable, but deck access is currently unauthenticated and the cards route leans heavily on untyped row handling. The most meaningful correctness risks were in the simulator and engine, where effect parsing and attack resolution could produce incorrect game outcomes. I fixed the clearest low-risk defects, added a safe env template, and verified the workspace with `bun run typecheck`.

## Project Map

- Root workspace: Bun workspaces + Turbo in [`package.json`](/home/jofre/projects/luminous/package.json) and [`turbo.json`](/home/jofre/projects/luminous/turbo.json).
- Backend app: Hono + Wrangler Cloudflare Worker in [`apps/backend/src/index.ts`](/home/jofre/projects/luminous/apps/backend/src/index.ts).
- Frontend app: React 19 + React Router 7 + Vite in [`apps/web/src/main.tsx`](/home/jofre/projects/luminous/apps/web/src/main.tsx) and [`apps/web/src/App.tsx`](/home/jofre/projects/luminous/apps/web/src/App.tsx).
- Shared engine: parsing, damage, attack, energy, condition, trainer, and ability logic in [`packages/engine/src/index.ts`](/home/jofre/projects/luminous/packages/engine/src/index.ts).
- Data/modeling: D1 migrations in [`apps/backend/migrations`](/home/jofre/projects/luminous/apps/backend/migrations), seed data/scripts in [`apps/backend/data`](/home/jofre/projects/luminous/apps/backend/data) and [`apps/backend/scripts`](/home/jofre/projects/luminous/apps/backend/scripts).
- Documentation: root [`README.md`](/home/jofre/projects/luminous/README.md) is effectively empty; domain docs live under [`knowledge/README.md`](/home/jofre/projects/luminous/knowledge/README.md).

## Findings

### Security

- [HIGH] Security — [`apps/backend/src/routes/decks.ts#L6`](/home/jofre/projects/luminous/apps/backend/src/routes/decks.ts#L6) — Deck list and deck detail endpoints are exposed without any auth, ownership, or tenant separation.
- [LOW] Security — [`.env:1`](/home/jofre/projects/luminous/.env:1) — A live API key exists in the local env file; `.gitignore` excludes it, so this is an operational hygiene issue rather than a tracked-repo leak.

### Correctness & Bugs

- [HIGH] Bug — [`packages/engine/src/parser.ts#L188`](/home/jofre/projects/luminous/packages/engine/src/parser.ts#L188) — Coin-flip special-condition parsing used the wrong regex capture group, producing invalid condition values.
- [HIGH] Bug — [`packages/engine/src/attacks.ts#L96`](/home/jofre/projects/luminous/packages/engine/src/attacks.ts#L96) — Multi-coin attacks applied raw damage directly, bypassing weakness, resistance, and other normal damage calculation steps.
- [MEDIUM] Bug — [`packages/engine/src/abilities.ts#L30`](/home/jofre/projects/luminous/packages/engine/src/abilities.ts#L30) — Every ability was treated as once-per-turn, incorrectly blocking passive or repeatable abilities.
- [MEDIUM] Bug — [`apps/web/src/pages/simulator/useSimulatorActions.ts#L1139`](/home/jofre/projects/luminous/apps/web/src/pages/simulator/useSimulatorActions.ts#L1139) — Dragging a stadium card onto the stadium slot bypassed the normal legality checks used by the button flow.

### Performance & Optimization

- [MEDIUM] Perf — [`apps/web/src/pages/simulator/useSimulatorState.ts#L76`](/home/jofre/projects/luminous/apps/web/src/pages/simulator/useSimulatorState.ts#L76) — Every simulator action deep-compares entire state via `JSON.stringify`, which will get expensive as logs and board state grow.
- [MEDIUM] Perf — [`apps/backend/src/routes/cards.ts#L155`](/home/jofre/projects/luminous/apps/backend/src/routes/cards.ts#L155) — Name search uses `%query%`, which prevents normal index use and will degrade as the card table grows.
- [LOW] Perf — [`apps/backend/src/routes/cards.ts#L97`](/home/jofre/projects/luminous/apps/backend/src/routes/cards.ts#L97) — The filters endpoint runs many `DISTINCT` scans per request; response caching mitigates it, but it is still query-heavy.

### Code Organization & Architecture

- [MEDIUM] Org — [`apps/web/src/pages/simulator/useSimulatorActions.ts#L1`](/home/jofre/projects/luminous/apps/web/src/pages/simulator/useSimulatorActions.ts#L1) — The simulator action module is a large multi-responsibility file with setup, combat, trainer, retreat, and drag/drop logic collapsed together.
- [MEDIUM] Org — [`apps/backend/src/routes/cards.ts#L1`](/home/jofre/projects/luminous/apps/backend/src/routes/cards.ts#L1) — Query parsing, SQL assembly, row shaping, and response formatting all live in one route file, making it hard to test or evolve independently.

### Fragmentation & Duplication

- [LOW] Dup — [`apps/web/src/pages/simulator/useSimulatorActions.ts#L817`](/home/jofre/projects/luminous/apps/web/src/pages/simulator/useSimulatorActions.ts#L817) — Retreat logic is duplicated between the explicit `retreat` action and bench-to-active drag/drop behavior.
- [LOW] Dup — [`apps/web/src/pages/simulator/useSimulatorActions.ts#L765`](/home/jofre/projects/luminous/apps/web/src/pages/simulator/useSimulatorActions.ts#L765) — Trainer play behavior is split between `playTrainerCard` and `dropToStadium`, which is how the stadium legality bug slipped in.

### Readability & Maintainability

- [LOW] Maintainability — [`README.md#L1`](/home/jofre/projects/luminous/README.md#L1) — The root README does not describe setup, app boundaries, or local development flow.
- [LOW] Maintainability — [`apps/backend/src/routes/cards.ts#L42`](/home/jofre/projects/luminous/apps/backend/src/routes/cards.ts#L42) — Several helpers rely on `any`, which hides row-shape mistakes and makes future refactors riskier.

### Type Safety

- [MEDIUM] Type Safety — [`apps/backend/src/routes/cards.ts#L42`](/home/jofre/projects/luminous/apps/backend/src/routes/cards.ts#L42) — Untyped DB rows and `any[]` collections are used throughout the cards route.
- [LOW] Type Safety — [`apps/backend/src/routes/cards.ts#L251`](/home/jofre/projects/luminous/apps/backend/src/routes/cards.ts#L251) — Result mapping still uses `any` for row IDs and grouped relation payloads instead of explicit row interfaces.

## Prioritized Action Plan

```text
[HIGH] Security — apps/backend/src/routes/decks.ts:6 — Add auth/ownership checks before exposing stored decklists.
[HIGH] Bug — packages/engine/src/parser.ts:188 — Fix coin-flip special-condition capture to emit valid condition enums.
[HIGH] Bug — packages/engine/src/attacks.ts:96 — Route multi-coin attacks through normal damage calculation.
[MEDIUM] Bug — packages/engine/src/abilities.ts:30 — Restrict once-per-turn enforcement to abilities that explicitly say so.
[MEDIUM] Bug — apps/web/src/pages/simulator/useSimulatorActions.ts:1139 — Validate drag-played stadiums with the same rules as normal trainer play.
[MEDIUM] Perf — apps/web/src/pages/simulator/useSimulatorState.ts:76 — Replace JSON stringify diffing with explicit mutation markers or a lighter compare strategy.
[MEDIUM] Perf — apps/backend/src/routes/cards.ts:155 — Rework fuzzy card search to use a searchable normalized column or FTS index.
[MEDIUM] Org — apps/web/src/pages/simulator/useSimulatorActions.ts:1 — Split setup/combat/drag-drop logic into smaller modules with shared helpers.
[MEDIUM] Org — apps/backend/src/routes/cards.ts:1 — Extract query-building and row-mapping into testable helpers.
[MEDIUM] Type Safety — apps/backend/src/routes/cards.ts:42 — Introduce explicit row interfaces instead of `any`.
[LOW] Maintainability — README.md:1 — Add setup, package map, and local run instructions.
```

## Changes Made

### Security

- Added [`.env.example`](/home/jofre/projects/luminous/.env.example) so the repository has a safe environment template without relying on a live secret-bearing local file.

### Correctness

- Fixed the coin-flip special-condition parser in [`packages/engine/src/parser.ts#L188`](/home/jofre/projects/luminous/packages/engine/src/parser.ts#L188) so it now emits `Asleep`/`Burned`/etc. instead of the opponent-target phrase.
- Fixed multi-coin attack resolution in [`packages/engine/src/attacks.ts#L96`](/home/jofre/projects/luminous/packages/engine/src/attacks.ts#L96) so coin-based damage still flows through weakness/resistance logic.
- Tightened ability usage handling in [`packages/engine/src/abilities.ts#L11`](/home/jofre/projects/luminous/packages/engine/src/abilities.ts#L11) and [`packages/engine/src/abilities.ts#L31`](/home/jofre/projects/luminous/packages/engine/src/abilities.ts#L31) so only explicit once-per-turn abilities consume the turn-use flag.
- Added legality checks to stadium drag/drop in [`apps/web/src/pages/simulator/useSimulatorActions.ts#L1139`](/home/jofre/projects/luminous/apps/web/src/pages/simulator/useSimulatorActions.ts#L1139), matching the click-to-play trainer path.

### Fairness / Simulator Quality

- Replaced `sort(() => Math.random() - 0.5)` shuffles with the existing Fisher-Yates helper in [`apps/web/src/pages/simulator/useSimulatorActions.ts#L247`](/home/jofre/projects/luminous/apps/web/src/pages/simulator/useSimulatorActions.ts#L247), [`apps/web/src/pages/simulator/useSimulatorActions.ts#L402`](/home/jofre/projects/luminous/apps/web/src/pages/simulator/useSimulatorActions.ts#L402), and [`apps/web/src/pages/simulator/useSimulatorActions.ts#L465`](/home/jofre/projects/luminous/apps/web/src/pages/simulator/useSimulatorActions.ts#L465).

## Remaining Issues

- Deck endpoints still need an auth model. I did not invent one because that changes public behavior and likely deployment assumptions.
- The simulator state diffing strategy in [`apps/web/src/pages/simulator/useSimulatorState.ts#L76`](/home/jofre/projects/luminous/apps/web/src/pages/simulator/useSimulatorState.ts#L76) should be redesigned rather than micro-optimized.
- The cards route still needs row typing and likely a query-builder extraction before it becomes pleasant to maintain.
- Root documentation is still thin; I did not author a new README because it would require product/setup details not reliably discoverable from code alone.

## Recommendations

- Add tests around the rules engine, especially `parseEffectText`, `resolveAttack`, and trainer/ability restrictions. These modules encode domain rules and are easy to regress silently.
- Put an explicit auth decision in front of `/api/decks`: either document that the app is single-user/local-only, or add identity and ownership checks.
- Introduce a typed data-access layer for the backend instead of shaping D1 results inline inside route files.
- Split simulator actions into focused modules such as `setup`, `combat`, `trainers`, and `dragDrop` to reduce branching density.
- Add a real root README with local setup, environment variables, and package responsibilities.

## Verification

- `bun run typecheck`
