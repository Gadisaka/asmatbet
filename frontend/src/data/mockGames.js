/**
 * Design-only InOut poster cards. Real fixtures come from OddsPapi.
 * Set VITE_MOCK_GAMES=false to hide these cards.
 */
export const MOCK_GAMES_ENABLED =
  String(import.meta.env?.VITE_MOCK_GAMES ?? "true") !== "false";

function svgUri(body, width, height) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function posterMotif(kind) {
  switch (kind) {
    case "road":
      return `<path d="M70 430 L170 70 H230 L330 430" fill="none" stroke="#fff" stroke-width="28" stroke-linejoin="round"/><path d="M200 120 V400" stroke="rgba(0,0,0,0.35)" stroke-width="8" stroke-dasharray="18 16"/>`;
    case "coin":
      return `<circle cx="200" cy="210" r="108" fill="#fff"/><circle cx="200" cy="210" r="78" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="10"/><text x="200" y="232" text-anchor="middle" font-family="Arial,sans-serif" font-size="72" font-weight="800" fill="#111">$</text>`;
    case "blocks":
      return `<rect x="78" y="150" width="110" height="110" rx="16" fill="#fff"/><rect x="212" y="150" width="110" height="110" rx="16" fill="rgba(255,255,255,0.72)"/><rect x="145" y="284" width="110" height="110" rx="16" fill="rgba(255,255,255,0.88)"/>`;
    case "jet":
      return `<path d="M40 250 L250 120 L360 150 L250 190 L300 280 L230 230 L160 340 Z" fill="#fff"/>`;
    case "plinko":
      return `<circle cx="120" cy="140" r="14" fill="#fff"/><circle cx="200" cy="140" r="14" fill="#fff"/><circle cx="280" cy="140" r="14" fill="#fff"/><circle cx="160" cy="210" r="14" fill="#fff"/><circle cx="240" cy="210" r="14" fill="#fff"/><circle cx="120" cy="280" r="14" fill="#fff"/><circle cx="200" cy="280" r="14" fill="#fff"/><circle cx="280" cy="280" r="14" fill="#fff"/><circle cx="200" cy="360" r="28" fill="#fff"/>`;
    case "mines":
      return `<rect x="90" y="110" width="70" height="70" rx="10" fill="rgba(255,255,255,0.25)"/><rect x="165" y="110" width="70" height="70" rx="10" fill="#fff"/><rect x="240" y="110" width="70" height="70" rx="10" fill="rgba(255,255,255,0.25)"/><rect x="90" y="185" width="70" height="70" rx="10" fill="rgba(255,255,255,0.25)"/><rect x="165" y="185" width="70" height="70" rx="10" fill="rgba(255,255,255,0.55)"/><rect x="240" y="185" width="70" height="70" rx="10" fill="#fff"/><rect x="90" y="260" width="70" height="70" rx="10" fill="#fff"/><rect x="165" y="260" width="70" height="70" rx="10" fill="rgba(255,255,255,0.25)"/><rect x="240" y="260" width="70" height="70" rx="10" fill="rgba(255,255,255,0.55)"/>`;
    case "crash":
      return `<path d="M36 390 C140 390 150 120 364 70" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round"/><circle cx="364" cy="70" r="18" fill="#fff"/>`;
    case "tower":
      return `<rect x="150" y="80" width="100" height="340" rx="12" fill="#fff"/><rect x="128" y="150" width="144" height="16" fill="rgba(0,0,0,0.2)"/><rect x="128" y="230" width="144" height="16" fill="rgba(0,0,0,0.2)"/><rect x="128" y="310" width="144" height="16" fill="rgba(0,0,0,0.2)"/>`;
    case "keno":
      return `<circle cx="130" cy="160" r="36" fill="#fff"/><circle cx="220" cy="150" r="36" fill="rgba(255,255,255,0.75)"/><circle cx="300" cy="190" r="36" fill="#fff"/><circle cx="160" cy="250" r="36" fill="rgba(255,255,255,0.8)"/><circle cx="250" cy="270" r="36" fill="#fff"/>`;
    case "ball":
      return `<circle cx="200" cy="220" r="110" fill="#fff"/><path d="M200 110 L230 170 H170 Z M200 330 L170 270 H230 Z M90 220 L150 190 V250 Z M310 220 L250 250 V190 Z" fill="rgba(0,0,0,0.18)"/>`;
    case "stairs":
      return `<path d="M70 400 H160 V320 H230 V240 H310 V160 H360" fill="none" stroke="#fff" stroke-width="22" stroke-linejoin="round"/>`;
    case "bubbles":
      return `<circle cx="150" cy="250" r="70" fill="rgba(255,255,255,0.35)"/><circle cx="230" cy="180" r="88" fill="#fff"/><circle cx="270" cy="300" r="48" fill="rgba(255,255,255,0.8)"/>`;
    case "wheel":
      return `<circle cx="200" cy="220" r="120" fill="none" stroke="#fff" stroke-width="18"/><circle cx="200" cy="220" r="18" fill="#fff"/><path d="M200 100 V220 L300 260 M200 220 L110 280 M200 220 L120 140" stroke="#fff" stroke-width="10"/>`;
    case "cards":
      return `<rect x="110" y="120" width="120" height="168" rx="14" transform="rotate(-12 170 204)" fill="rgba(255,255,255,0.75)"/><rect x="170" y="130" width="120" height="168" rx="14" transform="rotate(8 230 214)" fill="#fff"/>`;
    case "dice":
      return `<rect x="78" y="150" width="130" height="130" rx="22" transform="rotate(-8 143 215)" fill="#fff"/><rect x="190" y="190" width="130" height="130" rx="22" transform="rotate(10 255 255)" fill="rgba(255,255,255,0.82)"/>`;
    default:
      return `<circle cx="200" cy="220" r="100" fill="#fff"/>`;
  }
}

const POSTERS = [
  ["mock-chicken-road", "Chicken Road", "road", "#f6c445", "#c2410c"],
  ["mock-chicken-coin", "Chicken Coin", "coin", "#fde047", "#ca8a04"],
  ["mock-mega-block", "Mega Block", "blocks", "#86efac", "#166534"],
  ["mock-lucky-jet", "Lucky Jet", "jet", "#38bdf8", "#1d4ed8"],
  ["mock-avia-masters", "Avia Masters", "jet", "#67e8f9", "#0f766e"],
  ["mock-plinko-drop", "Plinko Drop", "plinko", "#f9a8d4", "#9d174d"],
  ["mock-crystal-mines", "Crystal Mines", "mines", "#a5b4fc", "#312e81"],
  ["mock-crash-orbit", "Crash Orbit", "crash", "#fb7185", "#9f1239"],
  ["mock-tower-rush", "Tower Rush", "tower", "#fdba74", "#9a3412"],
  ["mock-hot-keno", "Hot Keno", "keno", "#facc15", "#b45309"],
  ["mock-penalty-fever", "Penalty Fever", "ball", "#4ade80", "#14532d"],
  ["mock-coin-flip", "Coin Flip", "coin", "#e5e7eb", "#374151"],
  ["mock-stairway", "Stairway", "stairs", "#c4b5fd", "#5b21b6"],
  ["mock-limbo-line", "Limbo Line", "crash", "#5eead4", "#115e59"],
  ["mock-sugar-pop", "Sugar Pop", "bubbles", "#fbcfe8", "#be185d"],
  ["mock-forest-arrow", "Forest Arrow", "stairs", "#86efac", "#14532d"],
  ["mock-diver-chest", "Diver Chest", "coin", "#7dd3fc", "#075985"],
  ["mock-hamster-run", "Hamster Run", "road", "#fdba74", "#ea580c"],
  ["mock-rocket-queen", "Rocket Queen", "jet", "#f0abfc", "#86198f"],
  ["mock-wheel-spin", "Wheel Spin", "wheel", "#fde68a", "#b45309"],
  ["mock-hilo-cards", "HiLo Cards", "cards", "#fecaca", "#991b1b"],
  ["mock-balloon-pop", "Balloon Pop", "bubbles", "#93c5fd", "#1e3a8a"],
  ["mock-dice-duel", "Dice Duel", "dice", "#ddd6fe", "#4c1d95"],
  ["mock-roulette-rush", "Roulette Rush", "wheel", "#fca5a5", "#7f1d1d"],
  ["mock-ink-steps", "Ink Steps", "stairs", "#94a3b8", "#0f172a"],
  ["mock-fruit-blast", "Fruit Blast", "bubbles", "#fb923c", "#9a3412"],
  ["mock-gold-bars", "Gold Bars", "blocks", "#facc15", "#854d0e"],
  ["mock-neon-plinko", "Neon Plinko", "plinko", "#22d3ee", "#155e75"],
  ["mock-safari-eggs", "Safari Eggs", "keno", "#bef264", "#3f6212"],
  ["mock-turbo-keno", "Turbo Keno", "keno", "#fb7185", "#881337"],
  ["mock-dragon-tower", "Dragon Tower", "tower", "#f87171", "#7f1d1d"],
  ["mock-moon-crash", "Moon Crash", "crash", "#e2e8f0", "#1e293b"],
];

function posterDataUri(title, kind, from, to) {
  const body = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="400" height="533" fill="url(#g)"/><circle cx="320" cy="80" r="90" fill="rgba(255,255,255,0.12)"/><circle cx="40" cy="460" r="120" fill="rgba(0,0,0,0.12)"/>${posterMotif(kind)}<text x="28" y="64" font-family="Arial,sans-serif" font-size="28" font-weight="800" fill="#ffffff">${title}</text>`;
  return svgUri(body, 400, 533);
}

/** InOut-style lobby cards. `mock` skips the real launch API. */
export const MOCK_INOUT_GAMES = POSTERS.map(([gameMode, title, kind, from, to]) => ({
  gameMode,
  title,
  description: `${title} preview`,
  iconUrl: posterDataUri(title, kind, from, to),
  multiplayer: false,
  rtp: "97%",
  mock: true,
}));

export function findMockInoutGame(gameMode) {
  return MOCK_INOUT_GAMES.find((game) => game.gameMode === gameMode) || null;
}
