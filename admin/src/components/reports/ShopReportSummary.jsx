function fmtMoney(value) {
  return Number(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtCount(value) {
  return Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function StatCard({ title, value, isCount }) {
  return (
    <div className="rounded-md border border-(--border) bg-(--surface) p-4 shadow-sm">
      <p className="text-sm font-semibold text-(--text)">{title}</p>
      <p className="mt-2 text-sm font-normal text-(--muted)">
        {isCount ? (
          <>
            <span className="font-mono text-(--text)"># </span>
            <span className="font-mono">{value}</span>
            <span className="ml-1">tickets</span>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block h-3.5 w-3.5 shrink-0 rounded-full bg-amber-500/90 ring-1 ring-amber-600/30"
                aria-hidden
              />
              <span className="font-mono">{value}</span>
              <span className="text-(--muted)">ETB</span>
            </span>
          </>
        )}
      </p>
    </div>
  );
}

const EMPTY_SHOP = {
  totalTicketsSold: 0,
  totalSoldPrice: 0,
  totalDepositAmount: 0,
  totalWithdrawAmount: 0,
  totalPaidTickets: 0,
  totalPaidAmount: 0,
  grandNet: 0,
};

export default function ShopReportSummary({ shop, loading, error }) {
  const s = shop || EMPTY_SHOP;

  if (loading) {
    return <p className="text-sm text-(--muted)">Loading shop summary…</p>;
  }

  if (error) {
    return (
      <p className="text-sm text-rose-600 dark:text-rose-400">
        {typeof error === "string" ? error : "Failed to load shop summary."}
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <StatCard title="Total tickets sold" value={fmtCount(s.totalTicketsSold)} isCount />
      <StatCard title="Sold tickets price" value={fmtMoney(s.totalSoldPrice)} />
      <StatCard title="Total Deposit Amount" value={fmtMoney(s.totalDepositAmount)} />
      <StatCard title="Total Withdraw Amount" value={fmtMoney(s.totalWithdrawAmount)} />
      <StatCard title="Total paid tickets" value={fmtCount(s.totalPaidTickets)} isCount />
      <StatCard title="Total paid amount" value={fmtMoney(s.totalPaidAmount)} />
      <div className="sm:col-span-2">
        <StatCard title="Grand Net" value={fmtMoney(s.grandNet)} />
      </div>
    </div>
  );
}

export function emptyShopSummary() {
  return { ...EMPTY_SHOP };
}
