import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { imageUrl } from "~/lib/api";
import { PlayerMat } from "./PlayerMat";
import { Draggable, Droppable } from "./DndComponents";
import type { DragPayload, SimulatorStore, SimulatorActions } from "./types";

interface SimulatorBoardProps {
  store: SimulatorStore;
  actions: SimulatorActions;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function SimulatorBoard({ store, actions, undo, redo, canUndo, canRedo }: SimulatorBoardProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [activeDrag, setActiveDrag] = useState<DragPayload | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    const payload = event.active.data.current as DragPayload | undefined;
    setActiveDrag(payload ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null);
    const payload = event.active.data.current as DragPayload | undefined;
    const overId = event.over?.id;
    if (!payload || !overId) return;

    const target = String(overId);

    // Handle trainer USE drop zone
    if (target.startsWith("trainer-use:")) {
      void actions.dropToTrainerUse(payload);
      return;
    }

    if (target.startsWith("active:")) {
      const playerIdx = Number(target.split(":")[1]) as 0 | 1;

      // During pending opponent switch, dropping opponent bench onto active confirms the switch
      if (store.pendingOpponentSwitch && payload.zone === "bench" && payload.playerIdx === store.pendingOpponentSwitch.opponentIdx) {
        void actions.confirmOpponentSwitch(payload.uid);
        return;
      }

      void actions.dropToActive(payload, playerIdx);
      return;
    }
    if (target.startsWith("bench-slot:")) {
      const [, p, b] = target.split(":");
      void actions.dropToBenchSlot(payload, Number(p) as 0 | 1, Number(b));
      return;
    }
    if (target.startsWith("bench:")) {
      const playerIdx = Number(target.split(":")[1]) as 0 | 1;
      void actions.dropToBench(payload, playerIdx);
      return;
    }
    if (target.startsWith("discard:")) {
      const playerIdx = Number(target.split(":")[1]) as 0 | 1;
      void actions.dropToDiscard(payload, playerIdx);
      return;
    }
    if (target.startsWith("hand:")) {
      const playerIdx = Number(target.split(":")[1]) as 0 | 1;
      void actions.dropToHand(payload, playerIdx);
      return;
    }
    if (target === "stadium") {
      void actions.dropToStadium(payload);
    }
  };

  const otherPlayerIdx = (store.currentTurn === 0 ? 1 : 0) as 0 | 1;
  const currentPlayer = store.players[store.currentTurn];
  const selectedUid = store.selectedHandUid[store.currentTurn];
  const active = currentPlayer.active;
  const pendingHandSelection = store.pendingHandSelection;
  const pendingDeckSearch = store.pendingDeckSearch;
  const pendingOpponentSwitch = store.pendingOpponentSwitch;
  const pendingHandCards = pendingHandSelection
    ? store.players[pendingHandSelection.playerIdx].hand.filter((card) =>
      pendingHandSelection.candidateUids.includes(card.uid))
    : [];
  const pendingCards = pendingDeckSearch
    ? store.players[pendingDeckSearch.playerIdx].deck.filter((card) =>
      pendingDeckSearch.candidateUids.includes(card.uid))
    : [];
  const attacks = active?.base.card.attacks ?? [];
  const abilities = active?.base.card.abilities ?? [];
  const isPlaying = store.phase === "playing";
  const isCurrentTurn = true; // controls always show current player
  const canAttackThisTurn = isPlaying && isCurrentTurn
    && !(store.turnNumber === 1 && store.currentTurn === store.firstPlayer);

  // Determine if we should show the USE drop zone:
  // only when dragging a non-Tool/non-TM trainer from the current player's hand
  const isDraggingTrainer = (() => {
    if (!activeDrag || activeDrag.zone !== "hand" || activeDrag.playerIdx !== store.currentTurn) return false;
    const card = currentPlayer.hand.find((c) => c.uid === activeDrag.uid);
    if (!card || card.card.category !== "Trainer") return false;
    if (card.card.trainer_type === "Tool" || card.card.trainer_type === "Technical Machine") return false;
    return true;
  })();

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveDrag(null)}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="sim" onClick={(e) => {
        if (!(e.target as HTMLElement).closest(".hand-card")) {
          void actions.deselectHandCard(store.currentTurn);
        }
      }}>
        <div className="play-area">
          <div className="board">
            <section className="mat">
              <PlayerMat
                pIdx={otherPlayerIdx}
                isTop={true}
                store={store}
                actions={actions}
                highlightBench={!!pendingOpponentSwitch}
              />

              <Droppable id="stadium" className="stadium">
                <div className="slot" data-label="STADIUM">
                  {store.stadium && (
                    <div className="card-wrap">
                      <img
                        src={imageUrl(store.stadium.card.card.image) ?? ""}
                        alt={store.stadium.card.card.name}
                        className="card-img"
                      />
                    </div>
                  )}
                </div>
              </Droppable>

              <PlayerMat
                pIdx={store.currentTurn}
                isTop={false}
                store={store}
                actions={actions}
                isDraggingTrainer={isDraggingTrainer}
              />
            </section>
            <div className="side">
              <button
                className="btn new-game"
                disabled={store.loading}
                onClick={actions.newGame}
                title="Create a new game from the current decklists"
              >
                New Game
              </button>
              <div className="time-travel">
                <button
                  className="btn time-btn"
                  disabled={!canUndo}
                  onClick={undo}
                  title="Undo (go back one move)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 14 4 9l5-5" />
                    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
                  </svg>
                </button>
                <button
                  className="btn time-btn"
                  disabled={!canRedo}
                  onClick={redo}
                  title="Redo (go forward one move)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15 14 5-5-5-5" />
                    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
                  </svg>
                </button>
              </div>
              <button
                className={`btn end-turn ${store.phase === "setup" && !currentPlayer.active ? "needs-active" : ""}`}
                disabled={store.phase === "idle" || (store.phase === "setup" && !currentPlayer.active)}
                onClick={actions.endTurn}
                title="End Turn"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                  <path d="M21 3v5h-5"/>
                </svg>
              </button>
            </div>
          </div>

          <div className="controls">
            {/* Action panel: attacks, abilities, retreat */}
            {isPlaying && active && (
              <div className="action-panel">
                {/* Attacks */}
                {attacks.length > 0 && (
                  <div className="action-group">
                    <span className="action-label">Attacks</span>
                    {attacks.map((atk, i) => (
                      <button
                        key={`atk-${i}`}
                        className="action-btn attack-btn"
                        disabled={!canAttackThisTurn}
                        onClick={() => void actions.useAttack(i)}
                        title={atk.effect ?? atk.name}
                      >
                        <span className="action-name">{atk.name}</span>
                        {atk.damage != null && atk.damage !== 0 && (
                          <span className="action-damage">{atk.damage}</span>
                        )}
                        {atk.cost && atk.cost.length > 0 && (
                          <span className="action-cost">
                            {atk.cost.map((c, j) => (
                              <span key={j} className={`energy-pip ${c.toLowerCase()}`} title={c} />
                            ))}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Abilities */}
                {abilities.length > 0 && (
                  <div className="action-group">
                    <span className="action-label">Abilities</span>
                    {abilities.map((ab, i) => (
                      <button
                        key={`ab-${i}`}
                        className="action-btn ability-btn"
                        disabled={active.usedAbilityThisTurn}
                        onClick={() => void actions.useAbility(active.uid, i)}
                        title={ab.effect}
                      >
                        <span className="action-type">{ab.type}</span>
                        <span className="action-name">{ab.name}</span>
                      </button>
                    ))}
                  </div>
                )}


                {/* Special Conditions indicator */}
                {(active.specialConditions?.length ?? 0) > 0 && (
                  <div className="action-group conditions">
                    <span className="action-label">Conditions</span>
                    {active.specialConditions.map((c) => (
                      <span key={c} className={`condition-badge ${c.toLowerCase()}`}>{c}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Droppable id={`hand:${store.currentTurn}`} className="hand">
              <div className="row">
                {currentPlayer.hand.map((card) => (
                  <button
                    key={card.uid}
                    className={`hand-card ${selectedUid === card.uid ? "selected" : ""}`}
                    onClick={() => void actions.selectHandCard(store.currentTurn, card.uid)}
                    onDoubleClick={() => {
                      if (card.card.category === "Trainer" && isPlaying) {
                        void actions.playTrainerCard(card.uid);
                      }
                    }}
                  >
                    <Draggable
                      id={`hand:${store.currentTurn}:${card.uid}`}
                      payload={{ playerIdx: store.currentTurn, zone: "hand", uid: card.uid }}
                      className="card-wrap"
                      style={{ width: "100%", height: "100%" }}
                    >
                      <img src={imageUrl(card.card.image) ?? ""} alt={card.card.name} />
                    </Draggable>
                  </button>
                ))}
              </div>
            </Droppable>
          </div>
        </div>

        <aside className="logs-sidebar" aria-label="Game logs">
          <div className="logs-header">
            <h2>Game Log</h2>
            <span className="logs-turn-info">
              {store.phase === "setup"
                ? "Setup Phase"
                : `Turn ${store.turnNumber} · P${store.currentTurn + 1}`}
            </span>
          </div>
          <div className="logs-list">
            {store.logs.length === 0 ? (
              <p className="log-empty">No actions yet.</p>
            ) : (
              store.logs.map((log, index) => (
                <div key={`${index}-${log}`} className="log-entry">
                  <span className="log-index">{String(store.logs.length - index).padStart(2, "0")}</span>
                  <p>{log}</p>
                </div>
              ))
            )}
          </div>
        </aside>
        {pendingHandSelection && (
          <div className="deck-search-modal" role="dialog" aria-modal="true" aria-label={pendingHandSelection.title}>
            <div className="deck-search-modal__panel">
              <div className="deck-search-modal__header">
                <div>
                  <h2>{pendingHandSelection.title}</h2>
                  <p>{pendingHandSelection.instruction}</p>
                </div>
                <span className="deck-search-modal__count">
                  {pendingHandSelection.selectedUids.length} / {pendingHandSelection.count}
                </span>
              </div>
              <div className="deck-search-modal__grid">
                {pendingHandCards.map((card) => {
                  const selected = pendingHandSelection.selectedUids.includes(card.uid);
                  const disabled = !selected && pendingHandSelection.selectedUids.length >= pendingHandSelection.count;
                  return (
                    <button
                      key={card.uid}
                      type="button"
                      className={`deck-search-card ${selected ? "selected" : ""}`}
                      disabled={disabled}
                      onClick={() => void actions.toggleHandSelectionCard(card.uid)}
                    >
                      <img src={imageUrl(card.card.image) ?? ""} alt={card.card.name} />
                      <span className="deck-search-card__name">{card.card.name}</span>
                    </button>
                  );
                })}
              </div>
              <div className="deck-search-modal__actions">
                <button
                  type="button"
                  className="btn"
                  disabled={pendingHandSelection.selectedUids.length < pendingHandSelection.minCount}
                  onClick={() => void actions.confirmHandSelection()}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}
        {pendingDeckSearch && (
          <div className="deck-search-modal" role="dialog" aria-modal="true" aria-label={pendingDeckSearch.title}>
            <div className="deck-search-modal__panel">
              <div className="deck-search-modal__header">
                <div>
                  <h2>{pendingDeckSearch.title}</h2>
                  <p>{pendingDeckSearch.instruction}</p>
                </div>
                <span className="deck-search-modal__count">
                  {pendingDeckSearch.selectedUids.length} / {pendingDeckSearch.count}
                </span>
              </div>
              <div className="deck-search-modal__grid">
                {pendingCards.map((card) => {
                  const selected = pendingDeckSearch.selectedUids.includes(card.uid);
                  const disabled = !selected && pendingDeckSearch.selectedUids.length >= pendingDeckSearch.count;
                  return (
                    <button
                      key={card.uid}
                      type="button"
                      className={`deck-search-card ${selected ? "selected" : ""}`}
                      disabled={disabled}
                      onClick={() => void actions.toggleDeckSearchCard(card.uid)}
                    >
                      <img src={imageUrl(card.card.image) ?? ""} alt={card.card.name} />
                      <span className="deck-search-card__name">{card.card.name}</span>
                    </button>
                  );
                })}
              </div>
              <div className="deck-search-modal__actions">
                {pendingDeckSearch.minCount === 0 && (
                  <button type="button" className="btn" onClick={() => void actions.cancelDeckSearch()}>
                    Skip
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  disabled={pendingDeckSearch.selectedUids.length < pendingDeckSearch.minCount}
                  onClick={() => void actions.confirmDeckSearch()}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}
        {pendingOpponentSwitch && (
          <div className="opponent-switch-banner">
            <span>Drag an opponent's Bench Pokémon to their Active spot</span>
            <button type="button" className="btn" onClick={() => void actions.cancelOpponentSwitch()}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </DndContext>
  );
}
