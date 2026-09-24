import { useTranslation } from "../../i18n/LanguageContext.jsx";

/**
 * 21+ age restriction indicator for footer, forms, and compliance copy.
 */
function AgeRestrictionNotice({ variant = "inline", tone = "page", className = "" }) {
  const { t } = useTranslation();

  if (variant === "badge") {
    return (
      <span
        className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-white/20 bg-[#111111] px-2 text-[11px] font-extrabold tracking-wide text-[#8FCF4A] ${className}`.trim()}
        title={t("age.playersOnly")}
        aria-label={t("age.playersOnly")}
      >
        {t("age.badge")}
      </span>
    );
  }

  return (
    <p
      className={`m-0 text-center text-[11px] leading-relaxed ${
        tone === "onHeader" ? "text-(--sb-header-fg)/80" : "text-(--sb-text)"
      } ${className}`.trim()}
    >
      <span className="mr-1.5 inline-flex align-middle">
        <AgeRestrictionNotice variant="badge" />
      </span>
      {t("age.playersOnly")}
    </p>
  );
}

export default AgeRestrictionNotice;
