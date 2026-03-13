import { imageUrl } from "~/lib/api";
import { Draggable, Droppable } from "./DndComponents";
import type { SimulatorActions, SimulatorStore } from "./types";

interface PlayerMatProps {
  pIdx: 0 | 1;
  isTop: boolean;
  store: SimulatorStore;
  actions: SimulatorActions;
  isDraggingTrainer?: boolean;
  highlightBench?: boolean;
}

export function PlayerMat({ pIdx, isTop, store, actions, isDraggingTrainer, highlightBench }: PlayerMatProps) {
  const player = store.players[pIdx];
  const selectedPrize = store.selectedPrizeUid[pIdx];
  const hasUsedTrainers = player.trainerUseZone.length > 0;

  return (
    <div
      key={`player-board-${pIdx}-${store.currentTurn}`}
      className={`half ${isTop ? "top" : "bottom"}`}
    >
      <div className="grid">
        <div className="prizes">
          <div className="prizes-grid">
            {Array.from({ length: 6 }).map((_, i) => {
              const prize = player.prizes[i];
              if (!prize) return <div key={`empty-prize-${i}`} className="slot" data-label="Prize" />;
              const revealed = store.revealedPrizeUids[pIdx].includes(prize.uid);
              return (
                <button
                  key={prize.uid}
                  className={`slot filled ${selectedPrize === prize.uid ? "selected" : ""}`}
                  onClick={() => void actions.selectPrize(pIdx, prize.uid)}
                >
                  {revealed ? (
                    <Draggable
                      id={`prize:${pIdx}:${prize.uid}`}
                      payload={{ playerIdx: pIdx, zone: "prize", uid: prize.uid }}
                      className="card-wrap"
                      style={{ width: "100%", height: "100%" }}
                    >
                      <img src={imageUrl(prize.card.image) ?? ""} alt={prize.card.name} className="card-img" />
                    </Draggable>
                  ) : (
                    <div className="card-back">?</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <Droppable id={`active:${pIdx}`} className="active">
          {player.active ? (
            <div className="slot active-slot">
              <div className="card-wrap">
                <img src={imageUrl(player.active.base.card.image) ?? ""} alt={player.active.base.card.name} className="card-img" />
              </div>
            </div>
          ) : (
            <div className="slot active-slot" data-label="Active" />
          )}
        </Droppable>

        <Droppable id={`trainer-use:${pIdx}`} className={`trainer-use-zone ${isDraggingTrainer ? "drag-active" : ""}`}>
          {hasUsedTrainers ? (
            <div className="trainer-use-cards">
              {player.trainerUseZone.map((card) => (
                <div key={card.uid} className="trainer-use-card">
                  <img src={imageUrl(card.card.image) ?? ""} alt={card.card.name} className="card-img" />
                </div>
              ))}
            </div>
          ) : (
            <span className="trainer-use-label">USE</span>
          )}
        </Droppable>

        <Droppable id={`bench:${pIdx}`} className="bench">
          <div className={`bench-slot ${highlightBench ? "highlight-bench" : ""}`}>
            {player.bench.length === 0 && (
              <span className="label">Bench</span>
            )}
            {player.bench.map((bench, i) => (
              <Droppable key={bench.uid} id={`bench-slot:${pIdx}:${i}`} className="bench-card">
                <Draggable
                  id={`bench:${pIdx}:${bench.uid}`}
                  payload={{ playerIdx: pIdx, zone: "bench", uid: bench.uid }}
                  className="card-wrap"
                  style={{ width: "100%", height: "100%" }}
                >
                  <img src={imageUrl(bench.base.card.image) ?? ""} alt={bench.base.card.name} className="card-img" />
                </Draggable>
              </Droppable>
            ))}
          </div>
        </Droppable>

        <div className="deck">
          <div className="slot" data-label="Deck">
            {player.deck.length > 0 && (
              <div className="card-wrap" />
            )}
          </div>
        </div>

        <Droppable id={`discard:${pIdx}`} className="discard">
          <div className="slot" data-label="Discard">
            {player.discard.length > 0 && (
              <div className="card-wrap">
                <img src={imageUrl(player.discard[player.discard.length - 1].card.image) ?? ""} alt="Discard" className="card-img" />
              </div>
            )}
          </div>
        </Droppable>
      </div>
    </div>
  );
}
