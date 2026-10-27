import { useMemo, useState } from "react";
import { artUrl } from "../data/pokedex";
import type { RankedRow } from "../state/useRanker";
import {
  TYPE_ORDER,
  formatScore,
  formatSd,
  generationLabel,
  titleType,
  typeColor,
  typeInk,
} from "./presentation";

type Lean = { name: string; weight: number };

type Props = {
  rows: RankedRow[];
  leans: Lean[];
  species: number;
};

export function Rankings({ rows, leans, species }: Props) {
  const [type, setType] = useState("all");
  const [generation, setGeneration] = useState("all");
  const [query, setQuery] = useState("");
  const generations = useMemo(() => {
    const gens = new Set(rows.map((row) => row.pokemon.generation));
    return [...gens].sort((a, b) => a - b);
  }, [rows]);

  const shown = rows.filter((row) => {
    if (type !== "all" && !row.pokemon.types.includes(type)) return false;
    if (generation !== "all" && row.pokemon.generation !== Number(generation)) return false;
    if (query.trim() && !row.pokemon.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <section className="board">
      <div className="filters">
        <label>
          Search
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the dex"
            aria-label="Search"
          />
        </label>
        <label>
          Type
          <select aria-label="Type" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="all">All types</option>
            {TYPE_ORDER.map((name) => (
              <option key={name} value={name}>
                {titleType(name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Generation
          <select
            aria-label="Generation"
            value={generation}
            onChange={(event) => setGeneration(event.target.value)}
          >
            <option value="all">All generations</option>
            {generations.map((gen) => (
              <option key={gen} value={gen}>
                {generationLabel(gen)}
              </option>
            ))}
          </select>
        </label>
        <p className="shown">
          Showing {shown.length.toLocaleString()} of {species.toLocaleString()}
        </p>
      </div>
      {leans.length > 0 && (
        <p className="leans">
          Type leanings{" "}
          {leans.map((lean) => (
            <span key={lean.name} className={lean.weight >= 0 ? "up" : "down"}>
              {titleType(lean.name.slice(5))} {lean.weight >= 0 ? "+" : ""}
              {lean.weight.toFixed(2)}
            </span>
          ))}
        </p>
      )}
      <div className="ledger-head">
        <span>Rank</span>
        <span />
        <span>Species</span>
        <span>Gen</span>
        <span>Score</span>
        <span>Uncertainty</span>
        <span>Matchups</span>
      </div>
      <ol className="ledger">
        {shown.map((row) => (
          <li key={row.pokemon.id}>
            <span className="rank">{row.rank}</span>
            <span className="mini">
              {row.pokemon.art ? (
                <img src={artUrl(row.pokemon.art) ?? ""} alt="" loading="lazy" />
              ) : (
                <span>{row.pokemon.name.slice(0, 1)}</span>
              )}
            </span>
            <span className="who">
              <strong>{row.pokemon.name}</strong>
              <span className="types inline">
                {row.pokemon.types.map((name) => (
                  <span
                    key={name}
                    className="type"
                    style={{ background: typeColor(name), color: typeInk(name) }}
                  >
                    {titleType(name)}
                  </span>
                ))}
              </span>
            </span>
            <span className="gen">{generationLabel(row.pokemon.generation)}</span>
            <span className="score">{formatScore(row.score)}</span>
            <span className="sd" title="Laplace standard deviation of this species' strength">
              {formatSd(row.sd)}
              <i className="band" style={{ width: `${Math.min(100, row.sd * 36)}%` }} />
            </span>
            <span className="games">{row.games}</span>
          </li>
        ))}
      </ol>
      {shown.length === 0 && <p className="empty">Nothing in the dex matches that filter.</p>}
    </section>
  );
}
