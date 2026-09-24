export const THEME_STORAGE_KEY = "asmatbet:theme";
export const DEFAULT_THEME_ID = "navy";

/**
 * Grid order matches Shamo’s picker (row-first, two columns):
 * Light/Default, Evergreen/Carnival, Ethiopia/Midnight, Sunset/Golden,
 * Navy/Facebook, Telegram/TikTok, Stake/Safari.
 */
export const THEMES = Object.freeze([
  { id: "light", icon: "sun", swatch: "#0FB56A" },
  { id: "default", icon: "crown", swatch: "#FFB700" },
  { id: "evergreen", icon: "tree", swatch: "#06EF8E" },
  { id: "carnival", icon: "partyPopper", swatch: "#C90D26" },
  { id: "ethiopia", icon: "flag", swatch: "#FBDB09" },
  { id: "midnight", icon: "moon", swatch: "#3C94DD" },
  { id: "sunset", icon: "sun", swatch: "#F98006" },
  { id: "golden", icon: "crown", swatch: "#FAB300" },
  { id: "navy", icon: "shield", swatch: "#8FCF4A" },
  { id: "facebook", icon: "thumbsUp", swatch: "#1876F2" },
  { id: "telegram", icon: "send", swatch: "#28A0DC" },
  { id: "tiktok", icon: "music", swatch: "#FE2A54" },
  { id: "stake", icon: "diamond", swatch: "#1A7DFF" },
  { id: "safari", icon: "binoculars", swatch: "#00803E" },
]);

export const THEME_IDS = Object.freeze(THEMES.map((theme) => theme.id));

const THEME_ID_SET = new Set(THEME_IDS);

export function isThemeId(value) {
  return THEME_ID_SET.has(value);
}

export function resolveThemeId(value) {
  return isThemeId(value) ? value : DEFAULT_THEME_ID;
}

export function applyDocumentTheme(themeId) {
  const next = resolveThemeId(themeId);
  document.documentElement.dataset.theme = next;
  return next;
}
