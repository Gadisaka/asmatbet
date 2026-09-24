import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "../../i18n/LanguageContext.jsx";
import MatchesTabs from "./MatchesTabs.jsx";

function renderTabs(props) {
  return renderToStaticMarkup(
    createElement(
      LanguageProvider,
      null,
      createElement(MatchesTabs, props),
    ),
  );
}

describe("MatchesTabs", () => {
  const times = [
    { id: "1h", label: "1H" },
    { id: "3h", label: "3H" },
    { id: "12h", label: "12H" },
    { id: "today", label: "Today" },
    { id: "tomorrow", label: "Tomorrow" },
    { id: "day2", label: "Mon" },
    { id: "day3", label: "Tue" },
    { id: "day4", label: "Wed" },
  ];
  const leagues = [
    { id: "all-leagues", label: "All Leagues" },
    { id: "England - Premier League", label: "England - Premier League" },
    { id: "Spain - La Liga", label: "Spain - La Liga" },
    { id: "Italy - Serie A", label: "Italy - Serie A" },
  ];

  it("renders all time and league chips in one scroll row without dropdowns", () => {
    const html = renderTabs({
      times,
      leagues,
      selectedSportId: "football",
      selectedTimeId: "today",
      selectedLeagueId: "all-leagues",
    });

    expect(html).not.toContain("<select");
    expect(html).not.toContain("Select day");
    expect(html).not.toContain(">LEAGUES<");

    for (const time of times) {
      expect(html).toContain(`>${time.label}<`);
    }
    for (const league of leagues) {
      expect(html).toContain(`>${league.label}<`);
    }
  });
});
