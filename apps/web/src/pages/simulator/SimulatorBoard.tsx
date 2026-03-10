import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { imageUrl } from "~/lib/api";
import { getCardAttacks } from "~/lib/simulator";
import { PlayerMat } from "./PlayerMat";
import { Draggable, Droppable } from "./DndComponents";
import type { DragPayload, SimulatorStore, SimulatorActions } from "./types";

interface SimulatorBoardProps {
  store: SimulatorStore;
  actions: SimulatorActions;
}

export function SimulatorBoard({ store, actions }: SimulatorBoardProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const payload = event.active.data.current as DragPayload | undefined;
    const overId = event.over?.id;
    if (!payload || !overId) return;

    const target = String(overId);
    if (target.startsWith("active:")) {
      const playerIdx = Number(target.split(":")[1]) as 0 | 1;
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
    }
  };

  const otherPlayerIdx = (store.currentTurn === 0 ? 1 : 0) as 0 | 1;
  const currentPlayer = store.players[store.currentTurn];
  const selectedUid = store.selectedHandUid[store.currentTurn];

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="simulator-page selfplay-page">
        <div className="playmat-wrapper">
          <div className="playmat-spacer" />
          <section className="playmat">
            <PlayerMat
              pIdx={otherPlayerIdx}
              isTop={true}
              store={store}
              actions={actions}
            />

            <div className="shared-stadium">
              <div className="card-slot" data-label="STADIUM" />
            </div>

            <PlayerMat
              pIdx={store.currentTurn}
              isTop={false}
              store={store}
              actions={actions}
            />
          </section>
          <div className="playmat-side-actions">
            <button 
              className="sim-btn sim-btn--end-turn" 
              disabled={store.phase === "idle"} 
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

        <div className="player-controls">
          <Droppable id={`hand:${store.currentTurn}`} className="hand-container">
            <div className="hand-row">
              {currentPlayer.hand.map((card) => (
                <button
                  key={card.uid}
                  className={`hand-card-btn ${selectedUid === card.uid ? "hand-card-btn--selected" : ""}`}
                  onClick={() => void actions.selectHandCard(store.currentTurn, card.uid)}
                >
                  <Draggable
                    id={`hand:${store.currentTurn}:${card.uid}`}
                    payload={{ playerIdx: store.currentTurn, zone: "hand", uid: card.uid }}
                    className="play-card-wrapper"
                    style={{ width: "100%", height: "100%" }}
                  >
                    <img src={imageUrl(card.card.image) ?? ""} alt={card.card.name} />
                  </Draggable>
                </button>
              ))}
            </div>
            <div className="attack-panel">
              <button className="sim-btn" onClick={() => void actions.setSelectedActive(store.currentTurn)}>To Active</button>
              <button className="sim-btn" onClick={() => void actions.setSelectedBench(store.currentTurn)}>To Bench</button>
              <button className="sim-btn sim-btn--danger" onClick={() => void actions.discardSelectedCard(store.currentTurn)}>Discard</button>
            </div>
          </Droppable>

          {store.phase === "playing" && currentPlayer.active && (
            <div className="mat-panel attack-panel-main">
              {!store.detailCache[currentPlayer.active.base.card.id] ? (
                <button className="sim-btn sim-btn--primary" onClick={() => void actions.loadCardDetail(currentPlayer.active!.base.card.id)}>
                  Load attacks
                </button>
              ) : (
                <div className="attack-controls">
                  <select
                    className="attack-select"
                    value={String(store.selectedAttackIndex[store.currentTurn])}
                    onChange={(ev) => void actions.setAttackIndex(store.currentTurn, parseInt((ev.target as HTMLSelectElement).value, 10) || 0)}
                  >
                    {getCardAttacks(store.detailCache[currentPlayer.active.base.card.id]).map((atk, aIdx) => (
                      <option key={`${currentPlayer.active!.base.card.id}-${atk.name}-${aIdx}`} value={aIdx}>
                        {`${atk.name ?? "Attack"}${atk.damage ? ` (${String(atk.damage)})` : ""}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        {store.showGameLog && (
          <section className="mat-panel mat-panel--log">
            <h3>Game Log</h3>
            <ul>
              {store.logs.map((line, idx) => (
                <li key={`log-${idx}-${line}`}>{line}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </DndContext>
  );
}
