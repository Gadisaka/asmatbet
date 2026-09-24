import { useEffect, useState } from "react";
import { fetchPlayerInfoPages } from "../services/api";
import { pickTelegramContactFromPages } from "../utils/telegramContact";

/** CMS Telegram link used by the footer and the header icon. */
export function useTelegramContact() {
  const [telegram, setTelegram] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchPlayerInfoPages()
      .then((data) => {
        if (cancelled) return;
        setTelegram(
          pickTelegramContactFromPages(data?.pages, data?.telegramHref),
        );
      })
      .catch(() => {
        if (!cancelled) setTelegram(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return telegram;
}
