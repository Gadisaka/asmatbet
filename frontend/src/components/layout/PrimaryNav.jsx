import AppIcon from "../common/AppIcon";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "../../i18n/LanguageContext.jsx";

function PrimaryNav({ items }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const launchParam = new URLSearchParams(location.search).get("launch");

  return (
    <nav
      aria-label="Primary"
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-sm:order-last max-sm:w-full max-sm:flex-none max-sm:basis-full"
      style={{ justifyContent: "safe center" }}
    >
      {items.map((item) => {
        let isActive = false;
        if (item.launch) {
          isActive =
            location.pathname === "/casino" && launchParam === item.launch;
        } else if (item.id === "games") {
          isActive = location.pathname === "/casino" && !launchParam;
        } else {
          isActive = Boolean(item.path) && location.pathname === item.path;
        }

        return (
          <button
            key={item.id}
            type="button"
            className={`flex shrink-0 cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-[14px] px-2 py-1 text-[11px] font-semibold lg:px-2.5 lg:text-[12px] ${
              isActive
                ? "bg-(--sb-accent-fill) text-(--sb-on-accent)"
                : "bg-transparent text-(--sb-header-fg)"
            }`.trim()}
            onClick={() => {
              if (item.path) navigate(item.path);
            }}
          >
            <span
              className={`${isActive ? "text-(--sb-on-accent)" : "text-(--sb-header-fg)"} inline-flex items-center justify-center`}
            >
              <AppIcon name={item.icon} size={14} />
            </span>
            <span>{t(`nav.${item.id}`)}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default PrimaryNav;
