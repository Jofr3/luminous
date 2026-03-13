import { Hono } from "hono";
import { applySimulatorAction, evaluateSimulatorRules } from "@luminous/simulator-core";
import type { CardInstance, CardSummary, PlayerBoard, SimulatorAction, SimulatorStore } from "@luminous/simulator-core";
import type { AppEnv } from "../types";

const simulatorRoute = new Hono<AppEnv>();

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value || typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function reconstructDamage(raw: string): string | number | undefined {
  if (!raw) return undefined;
  const num = parseInt(raw, 10);
  if (!Number.isNaN(num) && String(num) === raw) return num;
  return raw;
}

function assembleAttacks(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const attack: Record<string, unknown> = {
      cost: safeJsonParse(row.cost as string | null | undefined, []),
      name: row.name,
    };
    const damage = reconstructDamage(String(row.damage_raw ?? ""));
    if (damage !== undefined) attack.damage = damage;
    if (row.effect != null) attack.effect = row.effect;
    return attack;
  });
}

function assembleCard(
  card: Record<string, unknown>,
  attacks: Array<Record<string, unknown>>,
  abilities: Array<Record<string, unknown>>,
  modifiers: Array<Record<string, unknown>>,
  types: Array<Record<string, unknown>>,
) {
  return {
    ...card,
    types: types.map((type) => type.type),
    attacks: assembleAttacks(attacks),
    abilities: abilities.map((ability) => ({ type: ability.type, name: ability.name, effect: ability.effect })),
    weaknesses: modifiers
      .filter((modifier) => modifier.kind === "weakness")
      .map((modifier) => ({ type: modifier.type, value: modifier.value })),
    resistances: modifiers
      .filter((modifier) => modifier.kind === "resistance")
      .map((modifier) => ({ type: modifier.type, value: modifier.value })),
  };
}

async function loadCardById(c: AppEnv["Bindings"] extends never ? never : any, id: string): Promise<CardSummary | null> {
  const db = c.env.DB as D1Database;
  const [card, attacks, abilities, modifiers, types] = await Promise.all([
    db.prepare(
      `SELECT c.id, c.local_id, c.name, c.image, c.category, c.rarity, c.hp,
              c.stage, c.trainer_type, c.energy_type, c.suffix, c.retreat, c.effect,
              c.evolve_from, c.set_id, s.name as set_name
       FROM cards c
       LEFT JOIN sets s ON c.set_id = s.id
       WHERE c.id = ?`
    ).bind(id).first(),
    db.prepare("SELECT * FROM card_attacks WHERE card_id = ? ORDER BY position").bind(id).all(),
    db.prepare("SELECT * FROM card_abilities WHERE card_id = ?").bind(id).all(),
    db.prepare("SELECT * FROM card_type_modifiers WHERE card_id = ?").bind(id).all(),
    db.prepare("SELECT * FROM card_types WHERE card_id = ?").bind(id).all(),
  ]);

  if (!card) return null;
  return assembleCard(
    card as Record<string, unknown>,
    attacks.results as Array<Record<string, unknown>>,
    abilities.results as Array<Record<string, unknown>>,
    modifiers.results as Array<Record<string, unknown>>,
    types.results as Array<Record<string, unknown>>,
  ) as unknown as CardSummary;
}

async function searchCardByName(c: AppEnv["Bindings"] extends never ? never : any, query: string): Promise<CardSummary | null> {
  const db = c.env.DB as D1Database;
  const exact = await db.prepare(
    `SELECT c.id
     FROM cards c
     WHERE lower(c.name) = lower(?)
     ORDER BY c.id ASC
     LIMIT 1`
  ).bind(query.trim()).first<{ id: string }>();

  if (exact?.id) {
    return loadCardById(c, exact.id);
  }

  const like = await db.prepare(
    `SELECT c.id
     FROM cards c
     WHERE c.name LIKE ?
     ORDER BY c.name ASC, c.id ASC
     LIMIT 1`
  ).bind(`%${query.trim()}%`).first<{ id: string }>();

  if (!like?.id) return null;
  return loadCardById(c, like.id);
}

function looksLikeCardId(query: string): boolean {
  return /^[a-z0-9.]+\-\d+[a-z]?$/i.test(query.trim());
}

function parseDecklist(input: string): { lines: Array<{ qty: number; query: string }>; errors: string[] } {
  const lines: Array<{ qty: number; query: string }> = [];
  const errors: string[] = [];
  const rawLines = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#") && !line.startsWith("//"));

  for (const raw of rawLines) {
    const match = raw.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (!match) {
      errors.push(`Could not parse line: "${raw}"`);
      continue;
    }

    const qty = parseInt(match[1], 10);
    const query = match[2].trim();
    if (!qty || qty < 1) {
      errors.push(`Invalid quantity in line: "${raw}"`);
      continue;
    }
    if (!query) {
      errors.push(`Missing card name/id in line: "${raw}"`);
      continue;
    }
    lines.push({ qty, query });
  }

  return { lines, errors };
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function drawFromDeck<T>(deck: T[], count: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < count && deck.length > 0; i += 1) {
    const card = deck.shift();
    if (card) out.push(card);
  }
  return out;
}

function hasBasicInHand(hand: CardInstance[]): boolean {
  return hand.some((card) => card.card.category === "Pokemon" && card.card.stage === "Basic");
}

function autoMulliganUntilBasic(player: Pick<PlayerBoard, "hand" | "deck" | "mulligans">) {
  if (!hasBasicInHand([...player.hand, ...player.deck])) return false;
  while (!hasBasicInHand(player.hand)) {
    player.mulligans += 1;
    player.deck = shuffle([...player.deck, ...player.hand]);
    player.hand = drawFromDeck(player.deck, 7);
  }
  return true;
}

function createEmptyPlayer(): PlayerBoard {
  return {
    deck: [],
    hand: [],
    prizes: [],
    discard: [],
    active: null,
    bench: [],
    takenPrizes: 0,
    mulligans: 0,
    trainerUseZone: [],
    energyAttachedThisTurn: false,
    supporterPlayedThisTurn: false,
    retreatedThisTurn: false,
    activeEffects: [],
  };
}

async function buildDeck(c: any, input: string, label: string, nextUid: () => string) {
  const parsed = parseDecklist(input);
  if (parsed.errors.length > 0) {
    return { deck: null, errors: parsed.errors.map((error) => `${label}: ${error}`) };
  }

  const cache = new Map<string, CardSummary | null>();
  const uniqueQueries = [...new Set(parsed.lines.map((line) => line.query))];
  for (const query of uniqueQueries) {
    const card = looksLikeCardId(query)
      ? await loadCardById(c, query.trim())
      : await searchCardByName(c, query);
    cache.set(query, card);
  }

  const deck: CardInstance[] = [];
  const errors: string[] = [];
  for (const line of parsed.lines) {
    const card = cache.get(line.query) ?? null;
    if (!card) {
      errors.push(`${label}: card not found for "${line.query}".`);
      continue;
    }
    for (let i = 0; i < line.qty; i += 1) {
      deck.push({ uid: nextUid(), card: card as CardSummary });
    }
  }

  if (errors.length > 0) {
    return { deck: null, errors };
  }
  if (deck.length !== 60) {
    return { deck: null, errors: [`${label}: deck has ${deck.length} cards. It must have exactly 60.`] };
  }

  return { deck: shuffle(deck), errors: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlayerIndex(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}

function isSimulatorStore(value: unknown): value is SimulatorStore {
  return (
    isRecord(value) &&
    (value.phase === "idle" || value.phase === "setup" || value.phase === "playing") &&
    Array.isArray(value.players) &&
    value.players.length === 2 &&
    isPlayerIndex(value.currentTurn) &&
    isPlayerIndex(value.firstPlayer) &&
    Array.isArray(value.stadiumUsedThisTurn) &&
    value.stadiumUsedThisTurn.length === 2
  );
}

function isNewGameBody(value: unknown): value is { deck1: string; deck2: string } {
  return isRecord(value) && typeof value.deck1 === "string" && typeof value.deck2 === "string";
}

function isDragPayload(value: unknown): value is { playerIdx: 0 | 1; uid: string; zone: "hand" | "active" | "bench" | "prize" } {
  return (
    isRecord(value) &&
    isPlayerIndex(value.playerIdx) &&
    typeof value.uid === "string" &&
    (value.zone === "hand" || value.zone === "active" || value.zone === "bench" || value.zone === "prize")
  );
}

function isSimulatorAction(value: unknown): value is SimulatorAction {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "selectPrize":
    case "selectHandCard":
      return isPlayerIndex(value.playerIdx) && typeof value.uid === "string";
    case "deselectHandCard":
      return isPlayerIndex(value.playerIdx);
    case "dropToActive":
    case "dropToBench":
    case "dropToDiscard":
    case "dropToHand":
      return isDragPayload(value.payload) && isPlayerIndex(value.targetPlayerIdx);
    case "dropToBenchSlot":
      return isDragPayload(value.payload) && isPlayerIndex(value.targetPlayerIdx) && typeof value.benchIdx === "number";
    case "dropToStadium":
    case "dropToTrainerUse":
      return isDragPayload(value.payload);
    case "useAttack":
      return typeof value.attackIdx === "number";
    case "useAbility":
      return typeof value.pokemonUid === "string" && typeof value.abilityIdx === "number";
    case "playTrainerCard":
    case "toggleHandSelectionCard":
    case "toggleDeckSearchCard":
    case "toggleDiscardSelectionCard":
    case "toggleEvolveFromDeckCard":
      return typeof value.uid === "string";
    case "confirmOpponentSwitch":
    case "confirmSelfSwitch":
    case "retreat":
      return typeof value.benchUid === "string";
    case "confirmHandSelection":
    case "confirmDeckSearch":
    case "cancelDeckSearch":
    case "confirmDiscardSelection":
    case "cancelDiscardSelection":
    case "cancelOpponentSwitch":
    case "cancelSelfSwitch":
    case "cancelRareCandy":
    case "confirmEvolveFromDeck":
    case "cancelEvolveFromDeck":
    case "useStadiumAbility":
    case "endTurn":
      return true;
    default:
      return false;
  }
}

simulatorRoute.post("/rules", async (c) => {
  const body = await c.req.json().catch(() => null);
  const store = isRecord(body) ? body.store : null;
  if (!isSimulatorStore(store)) {
    return c.json({ error: "Invalid simulator payload." }, 400);
  }
  return c.json({ data: evaluateSimulatorRules(store) });
});

simulatorRoute.post("/new-game", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!isNewGameBody(body)) {
    return c.json({ error: "Invalid simulator setup payload." }, 400);
  }

  let uidCounter = 0;
  const nextUid = () => {
    uidCounter += 1;
    return `sim-${uidCounter}`;
  };

  const [deck1Result, deck2Result] = await Promise.all([
    buildDeck(c, body.deck1, "Deck 1", nextUid),
    buildDeck(c, body.deck2, "Deck 2", nextUid),
  ]);

  const setupErrors = [...deck1Result.errors, ...deck2Result.errors];
  if (!deck1Result.deck || !deck2Result.deck) {
    return c.json({ error: "Unable to build decks.", details: setupErrors }, 400);
  }

  const p1 = createEmptyPlayer();
  const p2 = createEmptyPlayer();
  p1.deck = deck1Result.deck;
  p2.deck = deck2Result.deck;
  p1.hand = drawFromDeck(p1.deck, 7);
  p2.hand = drawFromDeck(p2.deck, 7);

  if (!autoMulliganUntilBasic(p1)) {
    return c.json({ error: "Deck 1 has no Basic Pokemon and cannot complete setup." }, 400);
  }
  if (!autoMulliganUntilBasic(p2)) {
    return c.json({ error: "Deck 2 has no Basic Pokemon and cannot complete setup." }, 400);
  }

  const shared = Math.min(p1.mulligans, p2.mulligans);
  const bonus1 = Math.max(0, p2.mulligans - shared);
  const bonus2 = Math.max(0, p1.mulligans - shared);
  p1.hand.push(...drawFromDeck(p1.deck, bonus1));
  p2.hand.push(...drawFromDeck(p2.deck, bonus2));

  const coinFlipResult = Math.random() < 0.5 ? "Heads" : "Tails";
  const firstPlayer = coinFlipResult === "Heads" ? 0 : 1;

  const store: SimulatorStore = {
    phase: "setup",
    winner: null,
    coinFlipResult,
    deckInput1: body.deck1,
    deckInput2: body.deck2,
    loading: false,
    firstPlayer,
    currentTurn: firstPlayer,
    turnNumber: 0,
    turnDrawDone: false,
    selectedHandUid: [null, null],
    selectedPrizeUid: [null, null],
    revealedPrizeUids: [[], []],
    nameQueryCache: {},
    logs: [
      `Mulligans -> P1: ${p1.mulligans}, P2: ${p2.mulligans}.`,
      `Coin flip: ${coinFlipResult}. P${firstPlayer + 1} goes first.`,
    ],
    players: [p1, p2],
    stadium: null,
    pendingHandSelection: null,
    pendingDeckSearch: null,
    pendingDiscardSelection: null,
    pendingOpponentSwitch: null,
    pendingSelfSwitch: null,
    pendingRareCandy: null,
    pendingEvolveFromDeck: null,
    stadiumUsedThisTurn: [false, false],
    gameStarted: true,
  };

  return c.json({ data: store });
});

simulatorRoute.post("/apply-action", async (c) => {
  const body = await c.req.json().catch(() => null);
  const store = isRecord(body) ? body.store : null;
  const action = isRecord(body) ? body.action : null;

  if (!isSimulatorStore(store) || !isSimulatorAction(action)) {
    return c.json({ error: "Invalid simulator action payload." }, 400);
  }

  return c.json({ data: applySimulatorAction(store, action) });
});

export { simulatorRoute };
