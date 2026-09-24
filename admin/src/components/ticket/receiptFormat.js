/**
 * Branch location line for thermal receipts (HTML + ESC/POS).
 */
export function formatCashierReceiptLine(ticket) {
  const branchLocation = String(ticket?.branchLocation ?? "").trim();
  return branchLocation || "—";
}

/** Branch name + selling cashier for payment receipts. */
export function formatBranchAgentLine(ticket) {
  const branch = String(ticket?.branchName ?? "").trim();
  const agent = String(ticket?.cashierName ?? "").trim();
  if (branch && agent) return `${branch} : ${agent}`;
  return branch || agent || "—";
}

/** Human-readable selection result for UI and receipts. */
export function formatSelectionResult(result) {
  const value = String(result || "PENDING").toUpperCase();
  switch (value) {
    case "WON":
      return "Won";
    case "LOST":
      return "Lost";
    case "VOID":
      return "Refunded";
    case "PENDING":
      return "Pending";
    default:
      return value;
  }
}

const PRINT_SIDE_TOKEN = {
  1: "Home",
  2: "Away",
  x: "Draw",
};

const PRINT_DOUBLE_CHANCE_TOKEN = {
  "1x": "Home or Draw",
  "12": "Home or Away",
  x2: "Draw or Away",
};

function mapPrintSideToken(token) {
  const key = String(token).toLowerCase();
  const doubleChance = PRINT_DOUBLE_CHANCE_TOKEN[key];
  if (doubleChance) return doubleChance;
  const mapped = PRINT_SIDE_TOKEN[key];
  return mapped ?? token;
}

function selectionOdds(selection) {
  const n = Number(selection?.odds);
  return Number.isFinite(n) ? n : null;
}

/** Lowest odds first; missing/invalid odds sort last (stable). */
export function sortSelectionsByOdds(selections) {
  if (!Array.isArray(selections)) return [];
  return selections
    .map((selection, index) => ({ selection, index }))
    .sort((a, b) => {
      const oa = selectionOdds(a.selection);
      const ob = selectionOdds(b.selection);
      if (oa == null && ob == null) return a.index - b.index;
      if (oa == null) return 1;
      if (ob == null) return -1;
      if (oa !== ob) return oa - ob;
      return a.index - b.index;
    })
    .map(({ selection }) => selection);
}

/** Print-only: map 1/2/X pick tokens to Home/Away/Draw on thermal + PDF slips. */
export function formatSelectionLabelForPrint(label) {
  const raw = String(label ?? "").trim();
  if (!raw) return "-";

  if (raw.includes("/")) {
    return raw
      .split("/")
      .map((seg) => mapPrintSideToken(seg.trim()))
      .join("/");
  }
  return mapPrintSideToken(raw);
}

/** Display handle for CMS contact entries on thermal receipts. */
export function formatContactHandle(entry) {
  const name = String(entry?.name ?? "").trim();
  const link = String(entry?.link ?? "").trim();
  if (!link) return name || "—";
  try {
    const u = new URL(link);
    const path = u.pathname.replace(/^\//, "");
    if (path.startsWith("@")) return path;
    const segment = path.split("/").filter(Boolean).pop();
    if (u.hostname.includes("t.me") && segment) {
      return segment.startsWith("@") ? segment : `@${segment}`;
    }
    if (segment) {
      return segment.startsWith("@") ? segment : `@${segment}`;
    }
  } catch {
    return link;
  }
  return name || link;
}
