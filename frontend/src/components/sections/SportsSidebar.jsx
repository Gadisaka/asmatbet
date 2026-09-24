import { Link } from "react-router-dom";
import Panel from "../common/Panel";
import AppIcon from "../common/AppIcon";
import { INFO_PAGES } from "../../data/infoPages";
import { useTranslation } from "../../i18n/LanguageContext.jsx";

function SportsSidebar({
  sports: _sports,
  selectedSportId: _selectedSportId,
  onSportChange: _onSportChange,
}) {
  const { t } = useTranslation();
  return (
    <Panel as="footer" className="shrink-0 border-t border-white/8">
      <nav className="px-2.5 py-2.5" aria-label={t("common.helpLegalNav")}>
        <p className="m-0 mb-1.5 text-[9px] font-extrabold uppercase tracking-[0.18em] text-(--sb-text)">
          {t("sidebar.infoSection")}
        </p>
        <ul className="m-0 list-none space-y-1 p-0">
          {INFO_PAGES.map(({ slug }) => (
            <li key={slug} className="m-0 p-0">
              <Link
                to={`/info/${slug}`}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border-0 bg-transparent px-0 py-1 text-left text-[10px] font-bold text-(--sb-text) no-underline transition-colors hover:bg-(--sb-bg-2) hover:text-(--sb-text)"
              >
                <span>{t(`infoPage.${slug}`)}</span>
                <AppIcon
                  name="chevronRight"
                  size={11}
                  className="shrink-0 opacity-70"
                />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </Panel>
  );
}

export default SportsSidebar;
