function formatYmd(date) {
  return date.toISOString().slice(0, 10);
}

export function getReportDatePreset(preset) {
  const today = new Date();
  const end = formatYmd(today);

  if (preset === "today") {
    return { from: end, to: end };
  }

  if (preset === "last7") {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { from: formatYmd(start), to: end };
  }

  if (preset === "thisMonth") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: formatYmd(start), to: end };
  }

  return { from: end, to: end };
}
