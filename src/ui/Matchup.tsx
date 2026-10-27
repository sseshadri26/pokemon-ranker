import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent } from "react";
import { artUrl } from "../data/pokedex";
import type { Pokemon } from "../data/types";
import type { AnswerOutcome } from "../model/history";
import { generationLabel, titleType, typeColor, typeInk } from "./presentation";

type Props = {
  left: Pokemon;
  right: Pokemon;
  onAnswer: (outcome: AnswerOutcome) => void;
  onUndo: () => void;
  canUndo: boolean;
};

export function Matchup({ left, right, onAnswer, onUndo, canUndo }: Props) {
  const swiped = useRef(false);
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onAnswer("a");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onAnswer("b");
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        onAnswer("tie");
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        onAnswer("skip");
      } else if (event.key === "Backspace") {
        event.preventDefault();
        onUndo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        onUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAnswer, onUndo]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if ((event.target as HTMLElement).closest(".forms")) return;
    drag.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom and some browsers throw if the pointer is already gone.
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    setOffset(event.clientX - drag.current.x);
  };

  const finishPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = null;
    setOffset(0);
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      swiped.current = true;
      onAnswer(dx > 0 ? "b" : "a");
    }
  };

  return (
    <section className="duel">
      <p className="sr-only" aria-live="polite">
        {left.name} versus {right.name}
      </p>
      <div
        className="stage"
        data-testid="stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        <SpeciesCard
          pokemon={left}
          side="a"
          testId="pick-a"
          hint="←"
          swiped={swiped}
          onAnswer={onAnswer}
        />
        <div className="versus">
          <div className="seal" style={{ transform: `translateX(${offset * 0.15}px)` }}>
            VS
          </div>
          <p className="swipe-hint" style={{ opacity: Number.isFinite(offset) ? Math.min(1, Math.abs(offset) / 90) : 0 }}>
            {offset === 0 ? "Swipe or tap" : offset < 0 ? `Pick ${left.name}` : `Pick ${right.name}`}
          </p>
          <button type="button" className="ghost" data-testid="tie" onClick={() => onAnswer("tie")}>
            Tie
            <kbd>↓</kbd>
          </button>
          <button type="button" className="texty" data-testid="skip" onClick={() => onAnswer("skip")}>
            Skip
            <kbd>↑</kbd>
          </button>
          <button type="button" className="texty" data-testid="undo" onClick={onUndo} disabled={!canUndo}>
            Undo
            <kbd>⌫</kbd>
          </button>
        </div>
        <SpeciesCard
          pokemon={right}
          side="b"
          testId="pick-b"
          hint="→"
          swiped={swiped}
          onAnswer={onAnswer}
        />
      </div>
      <p className="footnote">
        One vote ranks the species. Forms are there so you can see the whole family's looks. A tie is a half-win
        each way. Skip records nothing.
      </p>
    </section>
  );
}

function SpeciesCard({
  pokemon,
  side,
  testId,
  hint,
  swiped,
  onAnswer,
}: {
  pokemon: Pokemon;
  side: "a" | "b";
  testId: string;
  hint: string;
  swiped: MutableRefObject<boolean>;
  onAnswer: (outcome: AnswerOutcome) => void;
}) {
  const [formIndex, setFormIndex] = useState(0);
  useEffect(() => setFormIndex(0), [pokemon.id]);
  const forms = pokemon.forms.length > 0 ? pokemon.forms : [{
    name: pokemon.name,
    art: pokemon.art,
    types: pokemon.types,
    kind: "default" as const,
    pixel: false,
  }];
  const form = forms[Math.min(formIndex, forms.length - 1)];
  const portrait = artUrl(form.art) ?? artUrl(pokemon.art);

  return (
    <article className={`card ${side}`}>
      <button
        type="button"
        className="pick"
        data-testid={testId}
        aria-label={`Pick ${pokemon.name}`}
        onClick={() => {
          if (swiped.current) {
            swiped.current = false;
            return;
          }
          onAnswer(side);
        }}
      >
        <div className="portrait">
          {portrait ? (
            <img src={portrait} alt="" className={form.pixel ? "pixel" : ""} draggable={false} />
          ) : (
            <span className="monogram">{pokemon.name.slice(0, 1)}</span>
          )}
        </div>
        <p className="dex-no">#{String(pokemon.id).padStart(4, "0")}</p>
        <h2>{pokemon.name}</h2>
        {form.name !== pokemon.name && <p className="form-name">{form.name}</p>}
        <div className="types">
          {form.types.map((type) => (
            <span
              key={type}
              className="type"
              style={{ background: typeColor(type), color: typeInk(type) }}
            >
              {titleType(type)}
            </span>
          ))}
        </div>
        <p className="meta">
          <span>{generationLabel(pokemon.generation)}</span>
          {pokemon.stage > 1 && <span>Stage {pokemon.stage}</span>}
          {pokemon.starter && <span>Starter</span>}
          {pokemon.legendary && <span>Legendary</span>}
          {pokemon.mythical && <span>Mythical</span>}
          {pokemon.baby && <span>Baby</span>}
        </p>
        <span className="hint">Pick {hint}</span>
      </button>
      {forms.length > 1 && (
        <div className="forms" aria-label={`${pokemon.name} forms`}>
          {forms.map((entry, index) => (
            <button
              key={`${entry.name}-${index}`}
              type="button"
              className={index === formIndex ? "form on" : "form"}
              onClick={() => setFormIndex(index)}
              aria-pressed={index === formIndex}
            >
              {entry.art ? (
                <img src={artUrl(entry.art) ?? ""} alt="" className={entry.pixel ? "pixel" : ""} draggable={false} />
              ) : (
                <span>{entry.name.slice(0, 1)}</span>
              )}
              <span>{entry.name}</span>
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
