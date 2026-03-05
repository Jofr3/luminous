import { $, component$, useStore, useVisibleTask$ } from "@builder.io/qwik";
import { type DocumentHead } from "@builder.io/qwik-city";
import { fetchCardById, fetchCards, imageUrl } from "~/lib/api";
import {
  calculateAttackDamage,
  canPayAttackCost,
  getCardAttacks,
  knockoutPrizeCount,
} from "~/lib/simulator";
import type { CardDetail, CardSummary } from "~/lib/types";

type Phase = "idle" | "setup" | "playing";
type Zone = "hand" | "active" | "bench" | "prize";

interface DeckLine {
  qty: number;
  query: string;
}

interface CardInstance {
  uid: string;
  card: CardSummary;
}

interface PokemonInPlay {
  uid: string;
  base: CardInstance;
  damage: number;
  attached: CardInstance[];
}

interface DragPayload {
  playerIdx: 0 | 1;
  zone: Zone;
  uid: string;
}

interface PlayerBoard {
  name: string;
  deck: CardInstance[];
  hand: CardInstance[];
  prizes: CardInstance[];
  discard: CardInstance[];
  active: PokemonInPlay | null;
  bench: PokemonInPlay[];
  takenPrizes: number;
  mulligans: number;
  energyAttachedThisTurn: boolean;
}

interface SimulatorStore {
  phase: Phase;
  winner: string | null;
  coinFlipResult: "Heads" | "Tails" | null;
  deckInput1: string;
  deckInput2: string;
  loading: boolean;
  firstPlayer: 0 | 1;
  currentTurn: 0 | 1;
  turnNumber: number;
  turnDrawDone: boolean;
  selectedHandUid: [string | null, string | null];
  selectedPrizeUid: [string | null, string | null];
  selectedAttackIndex: [number, number];
  revealedPrizeUids: [string[], string[]];
  detailCache: Record<string, CardDetail>;
  nameQueryCache: Record<string, CardSummary | null>;
  logs: string[];
  players: [PlayerBoard, PlayerBoard];
  showDecklists: boolean;
  showGameLog: boolean;
}

const DEFAULT_DECKLIST = [
  "4 Pikachu",
  "4 Charmander",
  "4 Bulbasaur",
  "4 Squirtle",
  "4 Nest Ball",
  "4 Ultra Ball",
  "4 Potion",
  "4 Switch",
  "4 Professor's Research",
  "4 Boss's Orders",
  "12 Lightning Energy",
  "8 Fire Energy",
].join("\n");

let uidCounter = 0;

function nextUid(): string {
  uidCounter += 1;
  return `sim-${uidCounter}`;
}

function appendLog(store: SimulatorStore, message: string): void {
  store.logs = [message, ...store.logs].slice(0, 150);
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function drawFromDeck(player: PlayerBoard, count: number): CardInstance[] {
  const out: CardInstance[] = [];
  for (let i = 0; i < count && player.deck.length > 0; i += 1) {
    const card = player.deck.shift();
    if (card) out.push(card);
  }
  return out;
}

function isBasicPokemon(card: CardSummary): boolean {
  return card.category === "Pokemon" && card.stage === "Basic";
}

function makePokemonInPlay(instance: CardInstance): PokemonInPlay {
  return {
    uid: nextUid(),
    base: instance,
    damage: 0,
    attached: [],
  };
}

function createEmptyPlayer(name: string): PlayerBoard {
  return {
    name,
    deck: [],
    hand: [],
    prizes: [],
    discard: [],
    active: null,
    bench: [],
    takenPrizes: 0,
    mulligans: 0,
    energyAttachedThisTurn: false,
  };
}

function cardTitle(card: CardSummary): string {
  const hp = card.hp ? ` (${card.hp} HP)` : "";
  return `${card.name}${hp}`;
}

function parseDecklist(input: string): { lines: DeckLine[]; errors: string[] } {
  const lines: DeckLine[] = [];
  const errors: string[] = [];

  const rawLines = input
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("#") && !l.startsWith("//"));

  for (const raw of rawLines) {
    const m = raw.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (!m) {
      errors.push(`Could not parse line: \"${raw}\"`);
      continue;
    }

    const qty = parseInt(m[1], 10);
    const query = m[2].trim();

    if (!qty || qty < 1) {
      errors.push(`Invalid quantity in line: \"${raw}\"`);
      continue;
    }

    if (!query) {
      errors.push(`Missing card name/id in line: \"${raw}\"`);
      continue;
    }

    lines.push({ qty, query });
  }

  return { lines, errors };
}

function looksLikeCardId(query: string): boolean {
  return /^[a-z0-9.]+\-\d+[a-z]?$/i.test(query.trim());
}

function summaryFromDetail(detail: CardDetail): CardSummary {
  return {
    id: detail.id,
    local_id: detail.local_id,
    name: detail.name,
    image: detail.image,
    category: detail.category,
    rarity: detail.rarity,
    hp: detail.hp,
    stage: detail.stage ?? null,
    trainer_type: detail.trainer_type ?? null,
    energy_type: detail.energy_type ?? null,
    suffix: detail.suffix ?? null,
    set_id: detail.set_id,
    set_name: detail.set_name,
  };
}

function normalizeName(v: string): string {
  return v.toLowerCase().replace(/\s+/g, " ").trim();
}

async function resolveCardSummary(store: SimulatorStore, query: string): Promise<CardSummary | null> {
  const key = normalizeName(query);
  if (store.nameQueryCache[key] !== undefined) {
    return store.nameQueryCache[key];
  }

  if (looksLikeCardId(query)) {
    try {
      const detail = await fetchCardById(query.trim());
      const summary = summaryFromDetail(detail);
      store.nameQueryCache[key] = summary;
      return summary;
    } catch {
      store.nameQueryCache[key] = null;
      return null;
    }
  }

  const res = await fetchCards({ q: query, limit: 100 });
  if (res.data.length === 0) {
    store.nameQueryCache[key] = null;
    return null;
  }

  const exact = res.data.find((c) => normalizeName(c.name) === key) ?? res.data[0];
  store.nameQueryCache[key] = exact;
  return exact;
}

async function buildDeckFromInput(store: SimulatorStore, input: string, label: string): Promise<CardInstance[] | null> {
  const parsed = parseDecklist(input);
  if (parsed.errors.length > 0) {
    for (const err of parsed.errors) appendLog(store, `${label}: ${err}`);
    return null;
  }

  const deck: CardInstance[] = [];
  for (const line of parsed.lines) {
    const summary = await resolveCardSummary(store, line.query);
    if (!summary) {
      appendLog(store, `${label}: card not found for \"${line.query}\".`);
      return null;
    }

    for (let i = 0; i < line.qty; i += 1) {
      deck.push({ uid: nextUid(), card: summary });
    }
  }

  if (deck.length !== 60) {
    appendLog(store, `${label}: deck has ${deck.length} cards. It must have exactly 60.`);
    return null;
  }

  return shuffle(deck);
}

function removeHandCard(player: PlayerBoard, uid: string): CardInstance | null {
  const idx = player.hand.findIndex((c) => c.uid === uid);
  if (idx === -1) return null;
  const [card] = player.hand.splice(idx, 1);
  return card ?? null;
}

function removeBenchPokemon(player: PlayerBoard, uid: string): PokemonInPlay | null {
  const idx = player.bench.findIndex((p) => p.uid === uid);
  if (idx === -1) return null;
  const [slot] = player.bench.splice(idx, 1);
  return slot ?? null;
}

function removePrizeCard(player: PlayerBoard, uid: string): CardInstance | null {
  const idx = player.prizes.findIndex((c) => c.uid === uid);
  if (idx === -1) return null;
  const [card] = player.prizes.splice(idx, 1);
  return card ?? null;
}

function getSelectedHandCard(player: PlayerBoard, selectedUid: string | null): CardInstance | null {
  if (!selectedUid) return null;
  return player.hand.find((c) => c.uid === selectedUid) ?? null;
}

function hasBasicInHand(hand: CardInstance[]): boolean {
  return hand.some((c) => isBasicPokemon(c.card));
}

function autoMulliganUntilBasic(player: PlayerBoard): void {
  while (!hasBasicInHand(player.hand)) {
    player.mulligans += 1;
    player.deck = shuffle([...player.deck, ...player.hand]);
    player.hand = drawFromDeck(player, 7);
  }
}

function takePrizeCards(attacker: PlayerBoard, amount: number): number {
  const toTake = Math.min(amount, attacker.prizes.length);
  const cards = attacker.prizes.splice(0, toTake);
  attacker.hand.push(...cards);
  attacker.takenPrizes += toTake;
  return toTake;
}

function promoteBench(player: PlayerBoard): void {
  if (player.active || player.bench.length === 0) return;
  const next = player.bench.shift();
  player.active = next ?? null;
}

function applyAutoKnockoutCheck(store: SimulatorStore): void {
  for (let defenderIdx = 0; defenderIdx < 2; defenderIdx += 1) {
    const defender = store.players[defenderIdx as 0 | 1];
    const attacker = store.players[(defenderIdx === 0 ? 1 : 0) as 0 | 1];

    const active = defender.active;
    if (!active) continue;

    const hp = Number(active.base.card.hp ?? 0);
    if (hp <= 0 || active.damage < hp) continue;

    defender.discard.push(active.base, ...active.attached);
    defender.active = null;

    const prizeAmount = knockoutPrizeCount(active.base.card.name);
    const taken = takePrizeCards(attacker, prizeAmount);

    appendLog(
      store,
      `${defender.name}'s ${active.base.card.name} was Knocked Out. ${attacker.name} took ${taken} Prize card(s).`,
    );

    promoteBench(defender);

    if (!defender.active && defender.bench.length === 0) {
      store.winner = attacker.name;
      appendLog(store, `${attacker.name} wins (opponent has no Pokemon in play).`);
    }

    if (attacker.prizes.length === 0) {
      store.winner = attacker.name;
      appendLog(store, `${attacker.name} wins (all Prize cards taken).`);
    }
  }
}

function canAct(store: SimulatorStore, playerIdx: 0 | 1, action: string): boolean {
  if (store.winner) return false;

  if (store.phase !== "playing") {
    appendLog(store, `Cannot ${action} before setup is finalized.`);
    return false;
  }

  if (store.currentTurn !== playerIdx) {
    appendLog(store, `only current player can ${action}.`);
    return false;
  }

  return true;
}

function readDragPayload(ev: DragEvent): DragPayload | null {
  const dt = ev.dataTransfer;
  if (!dt) return null;
  const raw = dt.getData("application/x-sim-card");
  if (!raw) return null;

  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

function canDropToSetupBench(store: SimulatorStore, playerIdx: 0 | 1): boolean {
  if (store.phase !== "setup" && store.phase !== "playing") return false;
  return store.players[playerIdx].bench.length < 5;
}

async function fetchDetailCached(store: SimulatorStore, id: string): Promise<CardDetail> {
  if (!store.detailCache[id]) {
    store.detailCache[id] = await fetchCardById(id);
  }
  return store.detailCache[id];
}

export default component$(() => {
  const store = useStore<SimulatorStore>({
    phase: "idle",
    winner: null,
    coinFlipResult: null,
    deckInput1: DEFAULT_DECKLIST,
    deckInput2: DEFAULT_DECKLIST,
    loading: false,
    firstPlayer: 0,
    currentTurn: 0,
    turnNumber: 1,
    turnDrawDone: false,
    selectedHandUid: [null, null],
    selectedPrizeUid: [null, null],
    selectedAttackIndex: [0, 0],
    revealedPrizeUids: [[], []],
    detailCache: {},
    nameQueryCache: {},
    logs: [
      "Loading decklists and setting up the game...",
    ],
    players: [createEmptyPlayer("Player 1"), createEmptyPlayer("Player 2")],
    showDecklists: false,
    showGameLog: false,
  });

  const autoSetup = $(async () => {
    store.loading = true;
    try {
      const deck1 = await buildDeckFromInput(store, store.deckInput1, "Player 1 Deck");
      const deck2 = await buildDeckFromInput(store, store.deckInput2, "Player 2 Deck");
      if (!deck1 || !deck2) return;

      const p1 = createEmptyPlayer("Player 1");
      const p2 = createEmptyPlayer("Player 2");
      p1.deck = deck1;
      p2.deck = deck2;

      p1.hand = drawFromDeck(p1, 7);
      p2.hand = drawFromDeck(p2, 7);

      autoMulliganUntilBasic(p1);
      autoMulliganUntilBasic(p2);

      const shared = Math.min(p1.mulligans, p2.mulligans);
      const bonus1 = Math.max(0, p2.mulligans - shared);
      const bonus2 = Math.max(0, p1.mulligans - shared);
      p1.hand.push(...drawFromDeck(p1, bonus1));
      p2.hand.push(...drawFromDeck(p2, bonus2));

      store.players = [p1, p2];
      store.winner = null;
      store.coinFlipResult = null;
      store.revealedPrizeUids = [[], []];
      store.selectedPrizeUid = [null, null];
      store.selectedHandUid = [null, null];
      store.currentTurn = 0;
      store.phase = "setup";

      appendLog(store, `Mulligans -> P1: ${p1.mulligans}, P2: ${p2.mulligans}.`);
      appendLog(store, `${p1.name}: place your Active Pokemon (required) and Bench, then click Ready.`);
    } finally {
      store.loading = false;
    }
  });

  const confirmSetup = $(() => {
    if (store.phase !== "setup") return;

    const player = store.players[store.currentTurn];
    if (!player.active) {
      appendLog(store, `${player.name} must place an Active Pokemon before continuing.`);
      return;
    }

    if (store.currentTurn === 0) {
      store.currentTurn = 1;
      appendLog(store, `${store.players[0].name} is ready.`);
      appendLog(store, `${store.players[1].name}: place your Active Pokemon (required) and Bench, then click Ready.`);
      return;
    }

    // Both players ready — finalize
    for (const p of store.players) {
      p.prizes = drawFromDeck(p, 6);
      p.energyAttachedThisTurn = false;
    }

    store.coinFlipResult = Math.random() < 0.5 ? "Heads" : "Tails";
    store.firstPlayer = store.coinFlipResult === "Heads" ? 0 : 1;
    store.currentTurn = store.firstPlayer;
    store.turnNumber = 1;
    store.turnDrawDone = false;
    store.phase = "playing";

    appendLog(store, `Coin flip: ${store.coinFlipResult}. ${store.players[store.firstPlayer].name} goes first.`);
    appendLog(store, "First player cannot attack on turn 1.");

    // Auto-draw for first player
    const firstP = store.players[store.firstPlayer];
    const drawn = drawFromDeck(firstP, 1);
    if (drawn.length > 0) {
      firstP.hand.push(...drawn);
      store.turnDrawDone = true;
      appendLog(store, `${firstP.name} drew a card.`);
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    autoSetup();
  });

  const selectHandCard = $((playerIdx: 0 | 1, uid: string) => {
    store.selectedHandUid[playerIdx] = uid;
  });

  const setSelectedActive = $((playerIdx: 0 | 1) => {
    const player = store.players[playerIdx];
    if (player.active) {
      appendLog(store, `${player.name} already has an Active Pokemon.`);
      return;
    }

    const selected = getSelectedHandCard(player, store.selectedHandUid[playerIdx]);
    if (!selected || !isBasicPokemon(selected.card)) {
      appendLog(store, `${player.name}: select a Basic Pokemon from hand.`);
      return;
    }

    const card = removeHandCard(player, selected.uid);
    if (!card) return;
    player.active = makePokemonInPlay(card);
    store.selectedHandUid[playerIdx] = null;
    appendLog(store, `${player.name} set Active: ${card.card.name}.`);
  });

  const setSelectedBench = $((playerIdx: 0 | 1) => {
    const player = store.players[playerIdx];
    if (!canDropToSetupBench(store, playerIdx)) {
      appendLog(store, `${player.name} Bench is full.`);
      return;
    }

    if (store.phase === "playing" && !canAct(store, playerIdx, "bench a Pokemon")) return;

    const selected = getSelectedHandCard(player, store.selectedHandUid[playerIdx]);
    if (!selected || !isBasicPokemon(selected.card)) {
      appendLog(store, `${player.name}: select a Basic Pokemon from hand.`);
      return;
    }

    const card = removeHandCard(player, selected.uid);
    if (!card) return;
    player.bench.push(makePokemonInPlay(card));
    store.selectedHandUid[playerIdx] = null;
    appendLog(store, `${player.name} benched ${card.card.name}.`);
  });

  const discardSelectedCard = $((playerIdx: 0 | 1) => {
    const player = store.players[playerIdx];
    const selectedUid = store.selectedHandUid[playerIdx];
    if (!selectedUid) return;

    const card = removeHandCard(player, selectedUid);
    if (!card) return;
    player.discard.push(card);
    store.selectedHandUid[playerIdx] = null;
    appendLog(store, `${player.name} discarded ${card.card.name}.`);
  });

  const attachSelectedEnergyTo = $((playerIdx: 0 | 1, target: "active" | number) => {
    if (store.phase !== "playing") return;
    if (!canAct(store, playerIdx, "attach Energy")) return;

    const player = store.players[playerIdx];
    if (player.energyAttachedThisTurn) {
      appendLog(store, `${player.name} already manually attached Energy this turn.`);
      return;
    }

    const selected = getSelectedHandCard(player, store.selectedHandUid[playerIdx]);
    if (!selected || selected.card.category !== "Energy") {
      appendLog(store, `${player.name}: select an Energy card from hand.`);
      return;
    }

    const energy = removeHandCard(player, selected.uid);
    if (!energy) return;

    if (target === "active") {
      if (!player.active) {
        player.hand.push(energy);
        appendLog(store, `${player.name} has no Active Pokemon.`);
        return;
      }
      player.active.attached.push(energy);
      appendLog(store, `${player.name} attached ${energy.card.name} to Active ${player.active.base.card.name}.`);
    } else {
      const bench = player.bench[target];
      if (!bench) {
        player.hand.push(energy);
        return;
      }
      bench.attached.push(energy);
      appendLog(store, `${player.name} attached ${energy.card.name} to Benched ${bench.base.card.name}.`);
    }

    player.energyAttachedThisTurn = true;
    store.selectedHandUid[playerIdx] = null;
  });

  const switchWithBench = $((playerIdx: 0 | 1, benchIdx: number) => {
    if (store.phase !== "playing") return;
    if (!canAct(store, playerIdx, "switch")) return;

    const player = store.players[playerIdx];
    if (!player.active) return;
    const bench = player.bench[benchIdx];
    if (!bench) return;

    const oldActive = player.active;
    player.active = bench;
    player.bench[benchIdx] = oldActive;
    appendLog(store, `${player.name} switched Active with a Benched Pokemon.`);
  });

  const changeDamage = $((playerIdx: 0 | 1, target: "active" | number, delta: number) => {
    const player = store.players[playerIdx];
    const slot = target === "active" ? player.active : player.bench[target];
    if (!slot) return;

    slot.damage = Math.max(0, slot.damage + delta);
    applyAutoKnockoutCheck(store);
  });

  const setAttackIndex = $((playerIdx: 0 | 1, index: number) => {
    store.selectedAttackIndex[playerIdx] = index;
  });

  const loadCardDetail = $(async (cardId: string) => {
    await fetchDetailCached(store, cardId);
  });

  const useAttack = $(async () => {
    if (store.phase !== "playing") {
      appendLog(store, "Attack is available during playing phase.");
      return;
    }

    const attackerIdx = store.currentTurn;
    const defenderIdx = (attackerIdx === 0 ? 1 : 0) as 0 | 1;

    if (!canAct(store, attackerIdx, "attack")) return;

    if (store.turnNumber === 1 && attackerIdx === store.firstPlayer) {
      appendLog(store, "First player cannot attack on turn 1.");
      return;
    }

    const attacker = store.players[attackerIdx];
    const defender = store.players[defenderIdx];

    if (!attacker.active || !defender.active) {
      appendLog(store, "Both sides need an Active Pokemon to attack.");
      return;
    }

    const attackerDetail = await fetchDetailCached(store, attacker.active.base.card.id);
    const defenderDetail = await fetchDetailCached(store, defender.active.base.card.id);

    const attacks = getCardAttacks(attackerDetail);
    const attackIdx = store.selectedAttackIndex[attackerIdx] ?? 0;
    const attack = attacks[attackIdx];

    if (!attack) {
      appendLog(store, `${attacker.active.base.card.name} has no selected attack.`);
      return;
    }

    if (!canPayAttackCost(attack, attacker.active.attached)) {
      appendLog(store, `${attacker.name} cannot pay the attack cost for ${attack.name ?? "attack"}.`);
      return;
    }

    const damage = calculateAttackDamage({
      attack,
      attacker: attackerDetail,
      defender: defenderDetail,
    });

    defender.active.damage += damage;
    appendLog(store, `${attacker.name} used ${attack.name ?? "attack"} for ${damage} damage.`);

    applyAutoKnockoutCheck(store);
  });

  const endTurn = $(() => {
    if (store.phase !== "playing") return;
    if (!canAct(store, store.currentTurn, "end turn")) return;

    const next = (store.currentTurn === 0 ? 1 : 0) as 0 | 1;
    store.currentTurn = next;
    store.turnNumber += 1;
    store.turnDrawDone = false;
    store.players[next].energyAttachedThisTurn = false;
    appendLog(store, `${store.players[next].name} turn.`);

    const player = store.players[next];
    const drawn = drawFromDeck(player, 1);
    if (drawn.length === 0) {
      store.winner = store.players[(next === 0 ? 1 : 0) as 0 | 1].name;
      appendLog(store, `${player.name} cannot draw at turn start and loses.`);
      return;
    }
    player.hand.push(...drawn);
    store.turnDrawDone = true;
    appendLog(store, `${player.name} drew a card.`);
  });

  const selectPrize = $((playerIdx: 0 | 1, uid: string) => {
    store.selectedPrizeUid[playerIdx] = uid;
  });

  const revealSelectedPrize = $((playerIdx: 0 | 1) => {
    const uid = store.selectedPrizeUid[playerIdx];
    if (!uid) return;
    if (!store.revealedPrizeUids[playerIdx].includes(uid)) {
      store.revealedPrizeUids[playerIdx] = [...store.revealedPrizeUids[playerIdx], uid];
    }
  });

  const takeSelectedPrizeToHand = $((playerIdx: 0 | 1) => {
    const player = store.players[playerIdx];
    const uid = store.selectedPrizeUid[playerIdx];
    if (!uid) return;

    const card = removePrizeCard(player, uid);
    if (!card) return;

    player.hand.push(card);
    store.revealedPrizeUids[playerIdx] = store.revealedPrizeUids[playerIdx].filter((x) => x !== uid);
    store.selectedPrizeUid[playerIdx] = null;
    appendLog(store, `${player.name} took a selected Prize card to hand.`);
  });

  const onDragStart = $((ev: DragEvent, payload: DragPayload) => {
    const dt = ev.dataTransfer;
    if (!dt) return;
    dt.effectAllowed = "move";
    dt.setData("application/x-sim-card", JSON.stringify(payload));
  });

  const allowDrop = $((ev: DragEvent) => {
    ev.preventDefault();
  });

  const onDropActive = $((ev: DragEvent, targetPlayerIdx: 0 | 1) => {
    ev.preventDefault();
    const payload = readDragPayload(ev);
    if (!payload) return;

    const sourcePlayer = store.players[payload.playerIdx];
    const targetPlayer = store.players[targetPlayerIdx];

    if (payload.zone === "bench" && payload.playerIdx === targetPlayerIdx) {
      const benchSlot = removeBenchPokemon(sourcePlayer, payload.uid);
      if (!benchSlot) return;

      if (!targetPlayer.active) {
        targetPlayer.active = benchSlot;
      } else {
        const oldActive = targetPlayer.active;
        targetPlayer.active = benchSlot;
        targetPlayer.bench.push(oldActive);
      }
      appendLog(store, `${targetPlayer.name} switched Active via drag-and-drop.`);
      return;
    }

    if (payload.zone !== "hand" || payload.playerIdx !== targetPlayerIdx) return;

    const card = removeHandCard(sourcePlayer, payload.uid);
    if (!card) return;

    if (card.card.category === "Energy") {
      if (!targetPlayer.active) {
        sourcePlayer.hand.push(card);
        return;
      }
      if (store.phase === "playing" && !canAct(store, targetPlayerIdx, "attach Energy")) {
        sourcePlayer.hand.push(card);
        return;
      }
      if (store.phase === "playing" && targetPlayer.energyAttachedThisTurn) {
        sourcePlayer.hand.push(card);
        appendLog(store, `${targetPlayer.name} already attached Energy this turn.`);
        return;
      }
      targetPlayer.active.attached.push(card);
      if (store.phase === "playing") targetPlayer.energyAttachedThisTurn = true;
      appendLog(store, `${targetPlayer.name} attached ${card.card.name} to Active via drag-and-drop.`);
      return;
    }

    if (!isBasicPokemon(card.card)) {
      sourcePlayer.hand.push(card);
      return;
    }

    if (!targetPlayer.active) {
      targetPlayer.active = makePokemonInPlay(card);
      appendLog(store, `${targetPlayer.name} set Active via drag-and-drop.`);
    } else {
      sourcePlayer.hand.push(card);
    }
  });

  const onDropBench = $((ev: DragEvent, targetPlayerIdx: 0 | 1) => {
    ev.preventDefault();
    const payload = readDragPayload(ev);
    if (!payload || payload.zone !== "hand" || payload.playerIdx !== targetPlayerIdx) return;

    const targetPlayer = store.players[targetPlayerIdx];
    if (targetPlayer.bench.length >= 5) return;

    if (store.phase === "playing" && !canAct(store, targetPlayerIdx, "bench a Pokemon")) return;

    const card = removeHandCard(targetPlayer, payload.uid);
    if (!card) return;

    if (!isBasicPokemon(card.card)) {
      targetPlayer.hand.push(card);
      return;
    }

    targetPlayer.bench.push(makePokemonInPlay(card));
    appendLog(store, `${targetPlayer.name} benched ${card.card.name} via drag-and-drop.`);
  });

  const onDropBenchSlot = $((ev: DragEvent, targetPlayerIdx: 0 | 1, benchIdx: number) => {
    ev.preventDefault();
    ev.stopPropagation();
    const payload = readDragPayload(ev);
    if (!payload || payload.playerIdx !== targetPlayerIdx) return;

    const targetPlayer = store.players[targetPlayerIdx];
    const benchSlot = targetPlayer.bench[benchIdx];
    if (!benchSlot) return;

    // Hand → bench slot
    if (payload.zone === "hand") {
      const card = removeHandCard(targetPlayer, payload.uid);
      if (!card) return;

      // Energy attachment
      if (card.card.category === "Energy") {
        if (store.phase === "playing" && !canAct(store, targetPlayerIdx, "attach Energy")) {
          targetPlayer.hand.push(card);
          return;
        }
        if (store.phase === "playing" && targetPlayer.energyAttachedThisTurn) {
          targetPlayer.hand.push(card);
          appendLog(store, `${targetPlayer.name} already attached Energy this turn.`);
          return;
        }
        benchSlot.attached.push(card);
        if (store.phase === "playing") targetPlayer.energyAttachedThisTurn = true;
        store.selectedHandUid[targetPlayerIdx] = null;
        appendLog(store, `${targetPlayer.name} attached ${card.card.name} to Benched ${benchSlot.base.card.name}.`);
        return;
      }

      // Not energy — put it back
      targetPlayer.hand.push(card);
      return;
    }

    // Bench → bench slot: swap positions
    if (payload.zone === "bench" && payload.uid !== benchSlot.uid) {
      const draggedIdx = targetPlayer.bench.findIndex((b) => b.uid === payload.uid);
      if (draggedIdx === -1) return;
      const temp = targetPlayer.bench[draggedIdx];
      targetPlayer.bench[draggedIdx] = benchSlot;
      targetPlayer.bench[benchIdx] = temp;
      appendLog(store, `${targetPlayer.name} rearranged bench.`);
    }
  });

  const onDropDiscard = $((ev: DragEvent, targetPlayerIdx: 0 | 1) => {
    ev.preventDefault();
    const payload = readDragPayload(ev);
    if (!payload || payload.playerIdx !== targetPlayerIdx || payload.zone !== "hand") return;

    const targetPlayer = store.players[targetPlayerIdx];
    const card = removeHandCard(targetPlayer, payload.uid);
    if (!card) return;
    targetPlayer.discard.push(card);
    appendLog(store, `${targetPlayer.name} discarded ${card.card.name} via drag-and-drop.`);
  });

  const onDropHand = $((ev: DragEvent, targetPlayerIdx: 0 | 1) => {
    ev.preventDefault();
    const payload = readDragPayload(ev);
    if (!payload || payload.playerIdx !== targetPlayerIdx || payload.zone !== "prize") return;

    const player = store.players[targetPlayerIdx];
    const card = removePrizeCard(player, payload.uid);
    if (!card) return;
    player.hand.push(card);

    store.revealedPrizeUids[targetPlayerIdx] = store.revealedPrizeUids[targetPlayerIdx].filter((x) => x !== payload.uid);
    appendLog(store, `${player.name} moved a revealed Prize to hand via drag-and-drop.`);
  });

  return (
    <div class="simulator-page selfplay-page">
      <div class="mat-toolbar">
        <div class="mat-toolbar__left">
          <button class="sim-btn sim-btn--danger" disabled={store.phase !== "playing"} onClick$={useAttack}>
            Attack
          </button>
        </div>
        <div class="mat-toolbar__right">
          <button
            class={{ "sim-btn": true, "sim-btn--toggled": store.showDecklists }}
            onClick$={() => { store.showDecklists = !store.showDecklists; }}
          >
            Decklists
          </button>
          <button
            class={{ "sim-btn": true, "sim-btn--toggled": store.showGameLog }}
            onClick$={() => { store.showGameLog = !store.showGameLog; }}
          >
            Log
          </button>
        </div>
      </div>

      <div class="mat-status-bar">
        <span class="mat-status-bar__phase">{store.loading ? "loading" : store.phase}</span>
        <span class="mat-status-bar__turn">{store.players[store.currentTurn].name} — Turn {store.turnNumber}</span>
        {store.coinFlipResult && <span>Coin: {store.coinFlipResult}</span>}
        {store.winner && <span class="mat-status-bar__winner">{store.winner} wins!</span>}
      </div>

      {store.showDecklists && (
        <section class="mat-panel deck-import-grid">
          <article class="mat-panel__section">
            <h3>Player 1 Deck (60)</h3>
            <textarea
              class="deck-input"
              value={store.deckInput1}
              onInput$={(ev) => {
                store.deckInput1 = (ev.target as HTMLTextAreaElement).value;
              }}
            />
          </article>
          <article class="mat-panel__section">
            <h3>Player 2 Deck (60)</h3>
            <textarea
              class="deck-input"
              value={store.deckInput2}
              onInput$={(ev) => {
                store.deckInput2 = (ev.target as HTMLTextAreaElement).value;
              }}
            />
          </article>
        </section>
      )}

      <div class="playmat-wrapper">
      <section class="playmat">
        {([
          ((store.currentTurn === 0 ? 1 : 0) as 0 | 1),
          store.currentTurn,
        ] as [0 | 1, 0 | 1]).map((pIdx, orderIdx) => {
          const player = store.players[pIdx];
          const selectedUid = store.selectedHandUid[pIdx];
          const selectedPrize = store.selectedPrizeUid[pIdx];
          const isTop = orderIdx === 0;
          const seatLabel =
            store.phase === "playing"
              ? (pIdx === store.firstPlayer ? "1st" : "2nd")
              : (pIdx === 0 ? "P1" : "P2");

          return (
            <div key={`player-board-${pIdx}-${store.currentTurn}`} class={{ "mat-half": true, "mat-half--top": isTop, "mat-half--bottom": !isTop }}>
              <div class="mat-half__header">
                <span class="mat-half__name">{player.name} ({seatLabel})</span>
              </div>

              <div class="mat-grid">
                {/* Prizes Zone */}
                <div class="zone-prizes">
                  <div class="prizes-container">
                    {Array.from({ length: 6 }).map((_, i) => {
                      const prize = player.prizes[i];
                      if (!prize) return <div key={`empty-prize-${i}`} class="card-slot" data-label="Prize" />;
                      const revealed = store.revealedPrizeUids[pIdx].includes(prize.uid);
                      return (
                        <button
                          key={prize.uid}
                          class={{ "card-slot": true, "card-slot--filled": true, "card-slot--selected": selectedPrize === prize.uid }}
                          onClick$={() => selectPrize(pIdx, prize.uid)}
                          draggable={revealed}
                          onDragStart$={(ev) => onDragStart(ev, { playerIdx: pIdx, zone: "prize", uid: prize.uid })}
                        >
                          {revealed ? (
                            <img src={imageUrl(prize.card.image) ?? ""} alt={prize.card.name} class="play-card-img" />
                          ) : (
                            <div class="card-back-icon">?</div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div class="attack-panel">
                    <button class="sim-btn" onClick$={() => revealSelectedPrize(pIdx)}>Reveal</button>
                    <button class="sim-btn" onClick$={() => takeSelectedPrizeToHand(pIdx)}>Take</button>
                  </div>
                </div>

                {/* Stadium Zone */}
                <div class="zone-stadium">
                  <div class="card-slot" data-label="Stadium" />
                </div>

                {/* Active Zone */}
                <div
                  class="zone-active"
                  onDragOver$={allowDrop}
                  onDrop$={(ev) => onDropActive(ev, pIdx)}
                >
                  {player.active ? (
                    <div class="card-slot card-slot--active">
                      <div class="play-card-wrapper">
                        <img src={imageUrl(player.active.base.card.image) ?? ""} alt={player.active.base.card.name} class="play-card-img" />
                        <div class="card-overlay card-overlay--damage">-{player.active.damage}</div>
                        <div class="card-overlay">Energy: {player.active.attached.length}</div>
                      </div>
                      <div class="attack-panel">
                        <button class="sim-btn" onClick$={() => changeDamage(pIdx, "active", 10)}>+10</button>
                        <button class="sim-btn" onClick$={() => changeDamage(pIdx, "active", -10)}>-10</button>
                        <button class="sim-btn" onClick$={() => attachSelectedEnergyTo(pIdx, "active")}>Attach</button>
                      </div>
                    </div>
                  ) : (
                    <div class="card-slot card-slot--active" data-label="Active" />
                  )}
                </div>

                {/* Bench Zone */}
                <div
                  class="zone-bench"
                  onDragOver$={allowDrop}
                  onDrop$={(ev) => onDropBench(ev, pIdx)}
                >
                  <div class="bench-container">
                    {Array.from({ length: 5 }).map((_, i) => {
                      const bench = player.bench[i];
                      if (!bench) return <div key={`empty-bench-${i}`} class="card-slot" data-label="Bench" />;
                      return (
                        <div
                          key={bench.uid}
                          class="card-slot card-slot--filled"
                          draggable={true}
                          onDragStart$={(ev) => onDragStart(ev, { playerIdx: pIdx, zone: "bench", uid: bench.uid })}
                          onDragOver$={allowDrop}
                          onDrop$={(ev) => onDropBenchSlot(ev, pIdx, i)}
                        >
                          <div class="play-card-wrapper">
                            <img src={imageUrl(bench.base.card.image) ?? ""} alt={bench.base.card.name} class="play-card-img" />
                            <div class="card-overlay card-overlay--damage">-{bench.damage}</div>
                            {bench.attached.length > 0 && (
                              <div class="card-overlay">Energy: {bench.attached.length}</div>
                            )}
                          </div>
                          <div class="attack-panel">
                            <button class="sim-btn" onClick$={() => switchWithBench(pIdx, i)}>Swap</button>
                            <button class="sim-btn" onClick$={() => attachSelectedEnergyTo(pIdx, i)}>Attach</button>
                            <button class="sim-btn" onClick$={() => changeDamage(pIdx, i, 10)}>+10</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Deck Zone */}
                <div class="zone-deck">
                  <div class="card-slot" data-label="Deck">
                    {player.deck.length > 0 && (
                      <div class="play-card-wrapper">
                        <div class="stack-count">{player.deck.length}</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Discard Zone */}
                <div
                  class="zone-discard"
                  onDragOver$={allowDrop}
                  onDrop$={(ev) => onDropDiscard(ev, pIdx)}
                >
                  <div class="card-slot" data-label="Discard">
                    {player.discard.length > 0 && (
                      <div class="play-card-wrapper">
                        <img src={imageUrl(player.discard[player.discard.length - 1].card.image) ?? ""} alt="Discard" class="play-card-img" />
                        <div class="stack-count">{player.discard.length}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Hand Zone */}
              {!isTop && (
                <div
                  class="hand-container"
                  onDragOver$={allowDrop}
                  onDrop$={(ev) => onDropHand(ev, pIdx)}
                >
                  <div class="hand-row">
                    {player.hand.map((card) => (
                      <button
                        key={card.uid}
                        class={{
                          "hand-card-btn": true,
                          "hand-card-btn--selected": selectedUid === card.uid,
                        }}
                        onClick$={() => selectHandCard(pIdx, card.uid)}
                        draggable={true}
                        onDragStart$={(ev) => onDragStart(ev, { playerIdx: pIdx, zone: "hand", uid: card.uid })}
                      >
                        <img src={imageUrl(card.card.image) ?? ""} alt={card.card.name} />
                      </button>
                    ))}
                  </div>
                  <div class="attack-panel">
                    <button class="sim-btn" onClick$={() => setSelectedActive(pIdx)}>To Active</button>
                    <button class="sim-btn" onClick$={() => setSelectedBench(pIdx)}>To Bench</button>
                    <button class="sim-btn sim-btn--danger" onClick$={() => discardSelectedCard(pIdx)}>Discard</button>
                  </div>
                </div>
              )}

              {/* Setup Ready Button */}
              {!isTop && store.phase === "setup" && store.currentTurn === pIdx && (
                <div class="mat-panel setup-ready-panel">
                  <button class="sim-btn sim-btn--primary" onClick$={confirmSetup}>
                    Ready
                  </button>
                </div>
              )}

              {/* Attack Selection Panel (Bottom player only) */}
              {!isTop && store.phase === "playing" && store.currentTurn === pIdx && player.active && (
                <div class="mat-panel attack-panel-main">
                  {!store.detailCache[player.active.base.card.id] ? (
                    <button class="sim-btn sim-btn--primary" onClick$={() => loadCardDetail(player.active!.base.card.id)}>
                      Load attacks
                    </button>
                  ) : (
                    <div class="attack-controls">
                      <select
                        class="attack-select"
                        value={String(store.selectedAttackIndex[pIdx])}
                        onChange$={(ev) => setAttackIndex(pIdx, parseInt((ev.target as HTMLSelectElement).value, 10) || 0)}
                      >
                        {getCardAttacks(store.detailCache[player.active.base.card.id]).map((atk, aIdx) => (
                          <option key={`${player.active!.base.card.id}-${atk.name}-${aIdx}`} value={aIdx}>
                            {`${atk.name ?? "Attack"}${atk.damage ? ` (${String(atk.damage)})` : ""}`}
                          </option>
                        ))}
                      </select>
                      <button class="sim-btn sim-btn--danger" onClick$={useAttack}>Use Attack</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>
      <div class="playmat-side-actions">
        <button class="sim-btn sim-btn--end-turn" disabled={store.phase !== "playing"} onClick$={endTurn}>
          End Turn
        </button>
      </div>
      </div>

      {store.showGameLog && (
        <section class="mat-panel mat-panel--log">
          <h3>Game Log</h3>
          <ul>
            {store.logs.map((line, idx) => (
              <li key={`log-${idx}-${line}`}>{line}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
});

export const head: DocumentHead = {
  title: "Luminous — Self-Play Simulator",
  meta: [
    {
      name: "description",
      content:
        "Play both sides of a Pokemon TCG match with setup, drag-and-drop board zones, and strict/manual rules.",
    },
  ],
};
