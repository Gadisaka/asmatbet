import OddsCell from "./OddsCell";
import {
  getMarketDisplayName,
  gridColsForMarket,
  resolveExpansionSelectionMeta,
} from "../../utils/marketDisplay";

function OddsGrid({
  marketLabel,
  odds,
  matchName,
  apiFixtureId,
  kickoffAt,
  matchStatus,
  fromLive,
  home,
  away,
  onOddsClick,
  selectedOdds,
}) {
  const gridClass = gridColsForMarket(marketLabel);

  return (
    <div className={`grid gap-1.5 p-2 ${gridClass}`}>
      {odds.map((odd) => {
        const selectionId = `${matchName}-${marketLabel}-${odd.id}`;
        const meta = resolveExpansionSelectionMeta(marketLabel, odd.id, {
          home,
          away,
        });
        return (
          <OddsCell
            key={`${marketLabel}-${odd.id}`}
            label={meta.displayLabel || meta.label}
            value={odd.value}
            layout="stacked"
            selected={selectedOdds?.has(selectionId)}
            onClick={() =>
              onOddsClick?.({
                id: selectionId,
                apiFixtureId,
                matchName,
                marketLabel: meta.marketLabel,
                label: meta.label,
                displayLabel: meta.displayLabel,
                marketCode: meta.marketCode,
                marketParams: meta.marketParams,
                value: odd.value,
                kickoffAt,
                matchStatus,
                fromLive,
              })
            }
            className="min-h-[44px]"
          />
        );
      })}
    </div>
  );
}

/**
 * @param {{
 *   marketLabel: string,
 *   displayMarketLabel?: string,
 *   odds: Array<{ id: string, value: string }>,
 *   matchName: string,
 *   apiFixtureId: unknown,
 *   kickoffAt: string | null,
 *   matchStatus: unknown,
 *   fromLive: boolean,
 *   home?: string,
 *   away?: string,
 *   onOddsClick?: (payload: Record<string, unknown>) => void,
 *   selectedOdds?: Set<string>,
 * }} props
 */
function ExpansionMarketSection({
  marketLabel,
  displayMarketLabel,
  odds,
  matchName,
  apiFixtureId,
  kickoffAt,
  matchStatus,
  fromLive,
  home,
  away,
  onOddsClick,
  selectedOdds,
}) {
  const headerLabel =
    displayMarketLabel || getMarketDisplayName(marketLabel);

  return (
    <section className="overflow-hidden rounded-xl bg-(--sb-bg-card)">
      <header className="border-b border-white/8 px-3 py-2 text-xs font-bold uppercase tracking-wide text-[#d6daea]">
        {headerLabel}
      </header>
      <OddsGrid
        marketLabel={marketLabel}
        odds={odds}
        matchName={matchName}
        apiFixtureId={apiFixtureId}
        kickoffAt={kickoffAt}
        matchStatus={matchStatus}
        fromLive={fromLive}
        home={home}
        away={away}
        onOddsClick={onOddsClick}
        selectedOdds={selectedOdds}
      />
    </section>
  );
}

export default ExpansionMarketSection;
