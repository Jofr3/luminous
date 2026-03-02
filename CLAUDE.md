# CLAUDE.md

## Project: Luminous

A Pokemon Trading Card Game (TCG) project.

## Pokemon TCG Knowledge Base

The `knowledge/` directory contains a comprehensive reference for all Pokemon TCG rules and mechanics, compiled from official sources. **Always consult these files when making decisions related to game rules, card mechanics, or gameplay logic.**

Key files:
- `knowledge/README.md` - Index and sources
- `knowledge/01-game-overview.md` - Win conditions, setup, zones
- `knowledge/02-card-types.md` - Pokemon, Trainer, Energy cards
- `knowledge/03-turn-structure.md` - Turn phases and actions
- `knowledge/04-attacking-and-damage.md` - Damage calculation order
- `knowledge/05-special-conditions.md` - Asleep, Burned, Confused, Paralyzed, Poisoned
- `knowledge/06-energy-types.md` - All 11 energy types
- `knowledge/07-type-matchups.md` - Weakness and resistance chart
- `knowledge/08-pokemon-variants.md` - ex, EX, GX, V, VMAX, VSTAR, Mega Evolution, etc.
- `knowledge/09-deck-building.md` - Deck construction rules
- `knowledge/10-advanced-rules.md` - Mulligans, sudden death, edge cases
- `knowledge/11-errata.md` - Official card text corrections

Raw source materials are in `resources/` (PDFs, HTML pages).

## Monorepo Structure

This is a Turborepo monorepo using Bun as the package manager.
- `apps/` - Application packages
- `packages/` - Shared libraries
