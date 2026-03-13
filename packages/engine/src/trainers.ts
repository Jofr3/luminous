import type { CardInstance, GameState, PlayerBoard, PokemonInPlay, EffectAction } from "./types";
import { parseEffectText } from "./parser";

function checkPlayConditions(effects: EffectAction[], state: GameState, playerIdx: 0 | 1): string | null {
  const opponentIdx = (playerIdx === 0 ? 1 : 0) as 0 | 1;
  for (const effect of effects) {
    if (effect.type === "play_condition" && effect.condition === "opponent_prizes") {
      const opponentPrizes = state.players[opponentIdx].prizes.length;
      if (effect.exact && opponentPrizes !== effect.count) {
        return `Can only be played when your opponent has exactly ${effect.count} Prize card(s) remaining (they have ${opponentPrizes}).`;
      }
    }
  }
  return null;
}

export interface TrainerPlayResult {
  valid: boolean;
  reason?: string;
  effects: EffectAction[];
  logs: string[];
}

/** Check if a trainer card can be played */
export function canPlayTrainer(
  card: CardInstance,
  playerBoard: PlayerBoard,
  state: GameState,
  playerIdx: 0 | 1,
): { allowed: boolean; reason?: string } {
  const data = card.card;
  if (data.category !== "Trainer") {
    return { allowed: false, reason: "Not a Trainer card." };
  }

  // Supporters: one per turn
  if (data.trainerType === "Supporter" && playerBoard.supporterPlayedThisTurn) {
    return { allowed: false, reason: "Already played a Supporter this turn." };
  }

  // First player, first turn: can't play Supporters
  if (data.trainerType === "Supporter" && state.turnNumber === 1 && playerIdx === state.firstPlayer) {
    return { allowed: false, reason: "Cannot play a Supporter on the first player's first turn." };
  }

  // Stadiums: can't play if same-name stadium already in play by you
  if (data.trainerType === "Stadium" && state.stadium) {
    if (state.stadium.card.card.name === data.name && state.stadium.playedByPlayer === playerIdx) {
      return { allowed: false, reason: "A Stadium with the same name is already in play (played by you)." };
    }
  }

  // Check card-specific play conditions from effect text
  const effects = parseEffectText(data.effect);
  const conditionError = checkPlayConditions(effects, state, playerIdx);
  if (conditionError) {
    return { allowed: false };
  }

  // Switch-opponent cards (Boss's Orders, Prime Catcher, etc.): opponent must have benched Pokemon
  const hasOpponentSwitch = effects.some((e) => e.type === "switch_pokemon" && e.player === "opponent");
  if (hasOpponentSwitch) {
    const opponentIdx = (playerIdx === 0 ? 1 : 0) as 0 | 1;
    if (state.players[opponentIdx].bench.length === 0) {
      return { allowed: false, reason: "Your opponent has no Benched Pokémon to switch." };
    }
  }

  // Rare Candy: not first turn, must have a Basic in play (not played this turn) and a Stage 2 in hand
  const hasRareCandy = effects.some((e) => e.type === "rare_candy");
  if (hasRareCandy) {
    if (state.turnNumber <= 2) {
      return { allowed: false, reason: "Cannot use Rare Candy on a player's first turn." };
    }
    const allInPlay = [playerBoard.active, ...playerBoard.bench].filter((p): p is PokemonInPlay => p !== null);
    const hasValidBasic = allInPlay.some((p) => p.base.card.stage === "Basic" && p.turnPlayedOrEvolved < state.turnNumber);
    if (!hasValidBasic) {
      return { allowed: false, reason: "No eligible Basic Pokémon in play (must not have been played this turn)." };
    }
    const hasStage2InHand = playerBoard.hand.some((c) => c.card.category === "Pokemon" && c.card.stage === "Stage2");
    if (!hasStage2InHand) {
      return { allowed: false, reason: "No Stage 2 Pokémon in your hand." };
    }
  }

  // Evolve-from-deck cards: must have valid targets in play and evolutions in deck
  const evolveFromDeck = effects.find((e) => e.type === "evolve_from_deck");
  if (evolveFromDeck && evolveFromDeck.type === "evolve_from_deck") {
    if (!evolveFromDeck.bypassFirstTurn && state.turnNumber <= 2) {
      return { allowed: false, reason: "Cannot use this card on a player's first turn." };
    }
    const allInPlay = [playerBoard.active, ...playerBoard.bench].filter((p): p is PokemonInPlay => p !== null);
    const eligiblePokemon = allInPlay.filter((p) => {
      if (!evolveFromDeck.bypassSameTurn && p.turnPlayedOrEvolved >= state.turnNumber) return false;
      return true;
    });
    if (eligiblePokemon.length === 0) {
      return { allowed: false, reason: "No eligible Pokémon in play to evolve." };
    }
    const hasEvoInDeck = playerBoard.deck.some((c) => {
      if (c.card.category !== "Pokemon" || c.card.stage === "Basic" || !c.card.stage) return false;
      if (!c.card.evolveFrom) return false;
      if (evolveFromDeck.excludeSuffix && c.card.suffix === evolveFromDeck.excludeSuffix) return false;
      if (evolveFromDeck.requireSuffix && c.card.suffix !== evolveFromDeck.requireSuffix) return false;
      if (evolveFromDeck.requireNoAbilities && c.card.abilities && c.card.abilities.length > 0) return false;
      if (evolveFromDeck.allowedNames && !evolveFromDeck.allowedNames.some((n) => c.card.name.startsWith(n))) return false;
      return eligiblePokemon.some((p) => p.base.card.name === c.card.evolveFrom);
    });
    if (!hasEvoInDeck) {
      return { allowed: false, reason: "No valid evolution targets in your deck." };
    }
  }

  // Cards that search deck and put Pokemon onto bench: bench must have space
  const searchToBench = effects.find((e) => e.type === "search_deck" && e.destination === "bench");
  if (searchToBench) {
    if (playerBoard.bench.length >= 5) {
      return { allowed: false, reason: "Your Bench is full." };
    }
  }

  // Cards that recover from discard pile: must have valid targets
  const recoverEffect = effects.find((e) => e.type === "recover_from_discard");
  if (recoverEffect && recoverEffect.type === "recover_from_discard") {
    const discardPile = playerBoard.discard;
    const candidates = recoverEffect.alternatives?.length
      ? recoverEffect.alternatives
      : [{ category: recoverEffect.category, filter: recoverEffect.filter }];
    const hasMatch = discardPile.some((c) =>
      candidates.some((candidate) => {
        if (candidate.category === "Pokemon") return c.card.category === "Pokemon";
        if (candidate.category === "Energy" && candidate.filter === "Basic Energy") {
          return c.card.category === "Energy" && c.card.energyType === "Normal";
        }
        if (candidate.category === "Energy") return c.card.category === "Energy";
        if (candidate.category === "Trainer" && candidate.filter === "Supporter") {
          return c.card.category === "Trainer" && c.card.trainerType === "Supporter";
        }
        if (candidate.category === "Trainer" && candidate.filter === "Item") {
          return c.card.category === "Trainer" && c.card.trainerType === "Item";
        }
        if (candidate.category === "Trainer") return c.card.category === "Trainer";
        return true;
      }),
    );
    if (!hasMatch) {
      return { allowed: false };
    }
  }

  // Tools: must have a target Pokemon without a tool
  if (data.trainerType === "Tool") {
    const hasValidTarget = playerBoard.active !== null || playerBoard.bench.length > 0;
    if (!hasValidTarget) {
      return { allowed: false, reason: "No Pokemon to attach this Tool to." };
    }
  }

  return { allowed: true };
}

/** Play a trainer card */
export function playTrainer(
  card: CardInstance,
  playerBoard: PlayerBoard,
  state: GameState,
  playerIdx: 0 | 1,
): TrainerPlayResult {
  const data = card.card;
  const logs: string[] = [];
  const effects = parseEffectText(data.effect);

  logs.push(`Player ${playerIdx + 1} plays ${data.name} (${data.trainerType}).`);

  // Track supporter usage
  if (data.trainerType === "Supporter") {
    playerBoard.supporterPlayedThisTurn = true;
  }

  // Handle stadiums
  if (data.trainerType === "Stadium") {
    // Discard existing stadium
    if (state.stadium) {
      const oldStadium = state.stadium;
      const owner = state.players[oldStadium.playedByPlayer];
      owner.discard.push(oldStadium.card);
      logs.push(`${oldStadium.card.card.name} is discarded.`);
    }
    state.stadium = { card, playedByPlayer: playerIdx };
    logs.push(`${data.name} is now in play.`);
    return { valid: true, effects, logs };
  }

  // Items, Supporters go to discard after use
  if (data.trainerType === "Item" || data.trainerType === "Supporter") {
    playerBoard.discard.push(card);
  }

  return { valid: true, effects, logs };
}

/** Attach a Tool to a Pokemon */
export function attachTool(
  toolCard: CardInstance,
  target: PokemonInPlay,
): { valid: boolean; reason?: string; log?: string } {
  // Check if Pokemon already has a tool
  const existingTool = target.attached.find((a) => a.card.trainerType === "Tool");
  if (existingTool) {
    return { valid: false, reason: `${target.base.card.name} already has a Tool attached (${existingTool.card.name}).` };
  }

  target.attached.push(toolCard);
  return { valid: true, log: `${toolCard.card.name} attached to ${target.base.card.name}.` };
}

/** Attach a Technical Machine to a Pokemon */
export function attachTechnicalMachine(
  tmCard: CardInstance,
  target: PokemonInPlay,
): { valid: boolean; log?: string } {
  target.attached.push(tmCard);
  return { valid: true, log: `${tmCard.card.name} attached to ${target.base.card.name}. It gains a new attack.` };
}

/** Get a Pokemon's tool card if any */
export function getAttachedTool(pokemon: PokemonInPlay): CardInstance | null {
  return pokemon.attached.find((a) => a.card.trainerType === "Tool") ?? null;
}

/** Get Technical Machine attacks available to a Pokemon */
export function getTechnicalMachineAttacks(pokemon: PokemonInPlay): CardInstance[] {
  return pokemon.attached.filter((a) => a.card.trainerType === "Technical Machine");
}
