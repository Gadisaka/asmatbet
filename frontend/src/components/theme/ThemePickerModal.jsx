import { useEffect } from "react";
import AppIcon from "../common/AppIcon";
import { useTranslation } from "../../i18n/LanguageContext.jsx";
import { useTheme } from "../../theme/ThemeProvider.jsx";
import { THEMES } from "../../theme/themes.js";

function ThemePickerModal() {
  const { t } = useTranslation();
  const { theme, setTheme, pickerOpen, closePicker } = useTheme();

  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") closePicker();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pickerOpen, closePicker]);

  if (!pickerOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 border-0 bg-black/60 backdrop-blur-[2px]"
        aria-label={t("common.close")}
        onClick={closePicker}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-picker-title"
        className="relative z-10 mb-0 w-full max-w-md overflow-hidden rounded-t-2xl border border-(--sb-border) bg-(--sb-bg-card) p-4 shadow-[0_-16px_48px_-12px_rgba(0,0,0,0.55)] sm:mb-8 sm:rounded-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2
            id="theme-picker-title"
            className="m-0 text-base font-extrabold text-(--sb-text)"
          >
            {t("theme.title")}
          </h2>
          <button
            type="button"
            onClick={closePicker}
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-(--sb-text-muted) hover:bg-(--sb-bg-2) hover:text-(--sb-text)"
            aria-label={t("common.close")}
          >
            <AppIcon name="x" size={18} strokeWidth={2.4} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {THEMES.map((item) => {
            const selected = item.id === theme;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTheme(item.id)}
                className={`flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                  selected
                    ? "border-(--sb-accent-fill) bg-(--sb-accent-surface) text-(--sb-accent-fill)"
                    : "border-transparent bg-(--sb-bg-2)/80 text-(--sb-text) hover:bg-(--sb-bg-2)"
                }`}
              >
                <span
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center"
                  style={{ color: item.swatch }}
                >
                  <AppIcon name={item.icon} size={18} strokeWidth={2.1} />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {t(`theme.${item.id}`)}
                </span>
                {selected ? (
                  <AppIcon
                    name="check"
                    size={16}
                    className="shrink-0 text-(--sb-accent-fill)"
                    strokeWidth={2.6}
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={closePicker}
          className="mt-4 flex h-11 w-full cursor-pointer items-center justify-center rounded-xl border-0 bg-(--sb-bg-2) text-sm font-bold text-(--sb-text) hover:bg-(--sb-surface-soft)"
        >
          {t("theme.done")}
        </button>
      </div>
    </div>
  );
}

export default ThemePickerModal;
