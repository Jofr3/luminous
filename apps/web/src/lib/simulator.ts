import type { CardAttack, CardDetail, CardSummary } from "./types";

export interface SimulatorRuleGroup {
  title: string;
  items: string[];
}

export const SIMULATOR_RULES: SimulatorRuleGroup[] = [
  {
    title: "Win conditions",
    items: [
      "Take all 6 Prize cards.",
      "Opponent has no Pokemon in play (Active + Bench).",
      "Opponent cannot draw at the start of their turn.",
    ],
  },
  {
    title: "Turn structure",
    items: [
      "Draw 1 card at the start of each turn.",
      "Actions in any order before attacking.",
      "One manual Energy attachment per turn.",
      "Attack ends your turn.",
      "First player cannot attack on turn 1.",
    ],
  },
  {
    title: "Deck building",
    items: [
      "Deck must have exactly 60 cards.",
      "Max 4 copies per card name (Basic Energy unlimited).",
      "Deck must include at least 1 Basic Pokemon.",
    ],
  },
  {
    title: "Damage order",
    items: [
      "Base damage.",
      "Attacker-side modifiers.",
      "Weakness (modern x2).",
      "Resistance (modern -30).",
      "Defender-side modifiers.",
      "Place counters (1 counter = 10 damage).",
    ],
  },
  {
    title: "Pokemon Checkup",
    items: [
      "Poisoned: +10 damage.",
      "Burned: +20 damage then coin flip to recover.",
      "Asleep: coin flip to recover.",
      "Paralyzed: recovers after owner's next turn.",
    ],
  },
  {
    title: "Errata used",
    items: [
      "Pokemon Tool is its own Trainer category.",
      "Modern \"up to X\" interpretation uses at least 1 unless draw up to X.",
      "Rare Candy first-turn and same-turn play restrictions remain enforced.",
    ],
  },
];

export interface DeckCard {
  uid: string;
  card: CardSummary;
}

export interface InPlayPokemon {
  slotId: string;
  card: DeckCard;
  hp: number;
  damage: number;
  attached: DeckCard[];
  special: {
    asleep: boolean;
    burned: boolean;
    confused: boolean;
    paralyzed: boolean;
    poisoned: boolean;
  };
  paralyzedTurnApplied?: number;
}

export interface SimulatorPlayer {
  name: string;
  deck: DeckCard[];
  hand: DeckCard[];
  discard: DeckCard[];
  prizes: DeckCard[];
  active: InPlayPokemon | null;
  bench: InPlayPokemon[];
  prizeCardsTaken: number;
  energyAttachedThisTurn: boolean;
}

export interface SimulatorState {
  ready: boolean;
  turn: number;
  firstPlayer: 0 | 1;
  currentPlayer: 0 | 1;
  winner: 0 | 1 | null;
  logs: string[];
  players: [SimulatorPlayer, SimulatorPlayer];
}

const BASIC_ENERGY_NAMES = new Set([
  "Grass Energy",
  "Fire Energy",
  "Water Energy",
  "Lightning Energy",
  "Psychic Energy",
  "Fighting Energy",
  "Darkness Energy",
  "Metal Energy",
  "Fairy Energy",
]);

let uidCounter = 0;

function nextUid(): string {
  uidCounter += 1;
  return `sc-${uidCounter}`;
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function draw(deck: DeckCard[], count: number): DeckCard[] {
  const drawn: DeckCard[] = [];
  for (let i = 0; i < count && deck.length > 0; i += 1) {
    const top = deck.shift();
    if (top) drawn.push(top);
  }
  return drawn;
}

function isBasicPokemon(card: CardSummary): boolean {
  return card.category === "Pokemon" && card.stage === "Basic";
}

function isBasicEnergy(card: CardSummary): boolean {
  return card.category === "Energy" && (
    card.energy_type === "Basic" ||
    BASIC_ENERGY_NAMES.has(card.name)
  );
}

function deckCopyLimit(card: CardSummary): number {
  return isBasicEnergy(card) ? 60 : 4;
}

function addRandomCards(
  source: CardSummary[],
  target: DeckCard[],
  targetCount: number,
  nameCopies: Map<string, number>,
): void {
  if (source.length === 0) return;

  let guard = 0;
  while (target.length < targetCount && guard < 20000) {
    guard += 1;
    const pick = source[Math.floor(Math.random() * source.length)];
    const copies = nameCopies.get(pick.name) ?? 0;
    const cap = deckCopyLimit(pick);

    if (copies >= cap) continue;

    target.push({ uid: nextUid(), card: pick });
    nameCopies.set(pick.name, copies + 1);
  }
}

export function buildDeckFromDatabasePools(pools: {
  basicPokemon: CardSummary[];
  trainers: CardSummary[];
  energies: CardSummary[];
}): DeckCard[] {
  const nameCopies = new Map<string, number>();
  const deck: DeckCard[] = [];

  addRandomCards(pools.basicPokemon, deck, 20, nameCopies);
  addRandomCards(pools.trainers, deck, 44, nameCopies);
  addRandomCards(pools.energies, deck, 60, nameCopies);

  return shuffle(deck).slice(0, 60);
}

export function validateDeck(deck: DeckCard[]): string[] {
  const errors: string[] = [];

  if (deck.length !== 60) {
    errors.push("Deck must contain exactly 60 cards.");
  }

  const copyMap = new Map<string, { count: number; card: CardSummary }>();
  for (const deckCard of deck) {
    const found = copyMap.get(deckCard.card.name);
    if (found) {
      found.count += 1;
    } else {
      copyMap.set(deckCard.card.name, { count: 1, card: deckCard.card });
    }
  }

  for (const [name, data] of copyMap.entries()) {
    const cap = deckCopyLimit(data.card);
    if (data.count > cap) {
      errors.push(`${name} exceeds copy limit (${data.count}/${cap}).`);
    }
  }

  const basics = deck.filter((c) => isBasicPokemon(c.card)).length;
  if (basics === 0) {
    errors.push("Deck must contain at least one Basic Pokemon.");
  }

  return errors;
}

export function makePokemonInPlay(deckCard: DeckCard): InPlayPokemon {
  const hp = Number(deckCard.card.hp ?? 0);

  return {
    slotId: nextUid(),
    card: deckCard,
    hp,
    damage: 0,
    attached: [],
    special: {
      asleep: false,
      burned: false,
      confused: false,
      paralyzed: false,
      poisoned: false,
    },
  };
}

function hasBasicInHand(hand: DeckCard[]): boolean {
  return hand.some((c) => isBasicPokemon(c.card));
}

function autoSetOpeningBoard(player: SimulatorPlayer): void {
  const basics = player.hand.filter((c) => isBasicPokemon(c.card));
  if (basics.length === 0) return;

  const activeCard = basics[0];
  player.hand = player.hand.filter((c) => c.uid !== activeCard.uid);
  player.active = makePokemonInPlay(activeCard);

  const benchCards = basics.slice(1, 6);
  const benchIds = new Set(benchCards.map((c) => c.uid));
  player.hand = player.hand.filter((c) => !benchIds.has(c.uid));
  player.bench = benchCards.map(makePokemonInPlay);
}

function resolveMulligan(player: SimulatorPlayer): number {
  let mulligans = 0;
  while (!hasBasicInHand(player.hand)) {
    mulligans += 1;
    player.deck = shuffle([...player.deck, ...player.hand]);
    player.hand = draw(player.deck, 7);
  }
  return mulligans;
}

export function initGameState(playerDecks: [DeckCard[], DeckCard[]]): SimulatorState {
  const deck0 = shuffle(playerDecks[0]);
  const deck1 = shuffle(playerDecks[1]);

  const players: [SimulatorPlayer, SimulatorPlayer] = [
    {
      name: "Player 1",
      deck: deck0,
      hand: draw(deck0, 7),
      discard: [],
      prizes: [],
      active: null,
      bench: [],
      prizeCardsTaken: 0,
      energyAttachedThisTurn: false,
    },
    {
      name: "Player 2",
      deck: deck1,
      hand: draw(deck1, 7),
      discard: [],
      prizes: [],
      active: null,
      bench: [],
      prizeCardsTaken: 0,
      energyAttachedThisTurn: false,
    },
  ];

  const mulliganA = resolveMulligan(players[0]);
  const mulliganB = resolveMulligan(players[1]);
  const shared = Math.min(mulliganA, mulliganB);

  const bonusA = Math.max(0, mulliganB - shared);
  const bonusB = Math.max(0, mulliganA - shared);

  players[0].hand.push(...draw(players[0].deck, bonusA));
  players[1].hand.push(...draw(players[1].deck, bonusB));

  autoSetOpeningBoard(players[0]);
  autoSetOpeningBoard(players[1]);

  players[0].prizes = draw(players[0].deck, 6);
  players[1].prizes = draw(players[1].deck, 6);

  const firstPlayer = (Math.random() < 0.5 ? 0 : 1) as 0 | 1;

  return {
    ready: true,
    turn: 1,
    firstPlayer,
    currentPlayer: firstPlayer,
    winner: null,
    logs: [
      `Setup complete. ${players[firstPlayer].name} goes first.`,
      `Mulligans: P1 ${mulliganA}, P2 ${mulliganB}.`,
    ],
    players,
  };
}

export function startTurnDraw(state: SimulatorState): { ok: boolean; message: string } {
  const player = state.players[state.currentPlayer];

  player.energyAttachedThisTurn = false;

  const drawn = draw(player.deck, 1);
  if (drawn.length === 0) {
    state.winner = state.currentPlayer === 0 ? 1 : 0;
    return {
      ok: false,
      message: `${player.name} cannot draw at turn start and loses the game.`,
    };
  }

  player.hand.push(...drawn);
  return { ok: true, message: `${player.name} drew 1 card.` };
}

function inferEnergyType(card: CardSummary): string | null {
  if (card.category !== "Energy") return null;
  const n = card.name.toLowerCase();
  if (n.includes("grass")) return "Grass";
  if (n.includes("fire")) return "Fire";
  if (n.includes("water")) return "Water";
  if (n.includes("lightning")) return "Lightning";
  if (n.includes("psychic")) return "Psychic";
  if (n.includes("fighting")) return "Fighting";
  if (n.includes("darkness")) return "Darkness";
  if (n.includes("metal")) return "Metal";
  if (n.includes("fairy")) return "Fairy";
  if (n.includes("dragon")) return "Dragon";
  return "Any";
}

export function canPayAttackCost(attack: CardAttack | undefined, attached: DeckCard[]): boolean {
  const cost = attack?.cost ?? [];
  if (cost.length === 0) return true;
  if (attached.length < cost.length) return false;

  const pools = attached.map((energy) => inferEnergyType(energy.card) ?? "Any");
  const used = new Set<number>();

  const typed = cost.filter((c) => c !== "Colorless");
  for (const req of typed) {
    let found = -1;
    for (let i = 0; i < pools.length; i += 1) {
      if (used.has(i)) continue;
      if (pools[i] === req || pools[i] === "Any") {
        found = i;
        break;
      }
    }
    if (found === -1) return false;
    used.add(found);
  }

  const remaining = cost.length - used.size;
  return attached.length - used.size >= remaining;
}

function parseField<T>(value: T | string | null | undefined, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function getCardAttacks(card: CardDetail): CardAttack[] {
  return parseField<CardAttack[]>(card.attacks, []);
}

function parseDamageNumber(damage: string | number | undefined): number {
  if (typeof damage === "number") return damage;
  if (!damage) return 0;
  const matched = damage.match(/\d+/);
  return matched ? parseInt(matched[0], 10) : 0;
}

function hasTypeWeakness(weaknesses: { type?: string }[], attackType: string | null): boolean {
  if (!attackType) return false;
  return weaknesses.some((w) => w.type === attackType);
}

function hasTypeResistance(resistances: { type?: string }[], attackType: string | null): boolean {
  if (!attackType) return false;
  return resistances.some((r) => r.type === attackType);
}

export function calculateAttackDamage(input: {
  attack: CardAttack;
  attacker: CardDetail;
  defender: CardDetail;
}): number {
  let damage = parseDamageNumber(input.attack.damage);

  if (damage <= 0) return 0;

  const attackerTypes = parseField<string[]>(input.attacker.types, []);
  const attackType = attackerTypes[0] ?? null;
  const defenderWeaknesses = parseField<{ type?: string }[]>(input.defender.weaknesses, []);
  const defenderResistances = parseField<{ type?: string }[]>(input.defender.resistances, []);

  if (hasTypeWeakness(defenderWeaknesses, attackType)) {
    damage *= 2;
  }

  if (hasTypeResistance(defenderResistances, attackType)) {
    damage -= 30;
  }

  return Math.max(0, damage);
}

export function knockoutPrizeCount(cardName: string): number {
  const lower = cardName.toLowerCase();
  if (lower.includes("vmax") || lower.includes("tag team") || lower.includes("mega")) {
    return 3;
  }
  if (
    lower.includes(" ex") ||
    lower.endsWith(" ex") ||
    lower.includes(" v") ||
    lower.includes(" vstar") ||
    lower.includes(" gx") ||
    lower.includes(" ex")
  ) {
    return 2;
  }
  return 1;
}

export function applyPokemonCheckup(state: SimulatorState): string[] {
  const updates: string[] = [];

  for (let pIndex = 0; pIndex < state.players.length; pIndex += 1) {
    const player = state.players[pIndex as 0 | 1];
    const active = player.active;
    if (!active) continue;

    if (active.special.poisoned) {
      active.damage += 10;
      updates.push(`${player.name} Active is Poisoned (+10).`);
    }

    if (active.special.burned) {
      active.damage += 20;
      const cured = Math.random() < 0.5;
      if (cured) active.special.burned = false;
      updates.push(`${player.name} Active is Burned (+20)${cured ? " and recovered" : ""}.`);
    }

    if (active.special.asleep) {
      const woke = Math.random() < 0.5;
      if (woke) active.special.asleep = false;
      updates.push(`${player.name} Active ${woke ? "woke up" : "stays Asleep"}.`);
    }

    if (active.special.paralyzed) {
      if ((active.paralyzedTurnApplied ?? -1) <= state.turn - 1) {
        active.special.paralyzed = false;
        updates.push(`${player.name} Active recovered from Paralyzed.`);
      }
    }
  }

  return updates;
}

export function promoteFromBench(player: SimulatorPlayer): void {
  if (player.active || player.bench.length === 0) return;
  const promoted = player.bench.shift();
  player.active = promoted ?? null;
}

export function takePrizes(player: SimulatorPlayer, amount: number): number {
  const take = Math.min(amount, player.prizes.length);
  const taken = player.prizes.splice(0, take);
  player.hand.push(...taken);
  player.prizeCardsTaken += take;
  return take;
}
