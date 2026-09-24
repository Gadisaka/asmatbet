export const MATCHES_PAGE_SIZE = 30;

export function getTotalPages(itemCount, pageSize = MATCHES_PAGE_SIZE) {
  if (!itemCount || itemCount <= 0) return 1;
  return Math.ceil(itemCount / pageSize);
}

export function slicePageItems(items, page, pageSize = MATCHES_PAGE_SIZE) {
  const list = Array.isArray(items) ? items : [];
  const totalPages = getTotalPages(list.length, pageSize);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: list.slice(start, start + pageSize),
    page: safePage,
    totalPages,
    totalItems: list.length,
  };
}

/**
 * Page buttons for pagination UI.
 * Numbers are page numbers; `"ellipsis"` marks a gap.
 * ≤5 pages: all shown. >5: e.g. 1 2 3 4 … 6 (adapts around the current page).
 */
export function getVisiblePageNumbers(currentPage, totalPages) {
  const total = Math.max(1, Number(totalPages) || 1);
  const current = Math.min(Math.max(1, Number(currentPage) || 1), total);

  if (total <= 5) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  // Near the start: 1 2 3 4 … last
  if (current <= 3) {
    return [1, 2, 3, 4, "ellipsis", total];
  }

  // Near the end: 1 … last-3 last-2 last-1 last
  if (current >= total - 2) {
    return [1, "ellipsis", total - 3, total - 2, total - 1, total];
  }

  // Middle: 1 … current-1 current current+1 … last
  return [1, "ellipsis", current - 1, current, current + 1, "ellipsis", total];
}
