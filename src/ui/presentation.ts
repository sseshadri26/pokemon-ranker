export const TYPE_ORDER = [
  "normal",
  "fire",
  "water",
  "electric",
  "grass",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
] as const;

const TYPE_COLORS: Record<string, string> = {
  normal: "#9a9a84",
  fire: "#ee8130",
  water: "#6390f0",
  electric: "#f7d02c",
  grass: "#7ac74c",
  ice: "#96d9d6",
  fighting: "#c22e28",
  poison: "#a33ea1",
  ground: "#e2bf65",
  flying: "#a98ff3",
  psychic: "#f95587",
  bug: "#a6b91a",
  rock: "#b6a136",
  ghost: "#735797",
  dragon: "#6f35fc",
  dark: "#705746",
  steel: "#b7b7ce",
  fairy: "#d685ad",
};

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? "#8d8678";
}

export function typeInk(type: string): string {
  const hex = typeColor(type).replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#1c1914" : "#fffaf3";
}

export function generationLabel(generation: number): string {
  return `Gen ${ROMAN[generation] ?? generation}`;
}

export function formatScore(score: number): string {
  const rounded = score.toFixed(2);
  return score > 0 ? `+${rounded}` : rounded;
}

export function formatSd(sd: number): string {
  return `±${sd.toFixed(2)}`;
}

export function titleType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
