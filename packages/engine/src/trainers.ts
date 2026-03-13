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

  // Cards that recover from discard pile: must have valid targets
  if (data.effect && /from your discard pile into your hand/i.test(data.effect)) {
    const discardPile = playerBoard.discard;
    const hasPokemon = discardPile.some((c) => c.card.category === "Pokemon");
    const hasBasicEnergy = discardPile.some((c) => c.card.category === "Energy" && c.card.energyType === "Normal");
    if (!hasPokemon && !hasBasicEnergy) {
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
