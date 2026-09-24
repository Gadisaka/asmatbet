export function pickTelegramContactFromPages(pages, telegramHref = "") {
  const href =
    typeof telegramHref === "string" && telegramHref.trim().startsWith("https://")
      ? telegramHref.trim()
      : "";

  const entries = Array.isArray(pages?.["contact-us"]?.entries)
    ? pages["contact-us"].entries
    : [];

  const looksLikeTelegram = (row) => {
    const name = String(row?.name || "").toLowerCase();
    const link = String(row?.link || "").toLowerCase();
    return (
      name.includes("telegram") ||
      link.includes("t.me/") ||
      link.includes("telegram.me/") ||
      link.includes("telegram")
    );
  };

  const preferred = entries.find(looksLikeTelegram) || entries[0];
  const logo = typeof preferred?.logo === "string" ? preferred.logo.trim() : "";
  const link =
    (typeof preferred?.link === "string" ? preferred.link.trim() : "") || href;

  if (!link) return null;
  return { logo: logo || null, link };
}
