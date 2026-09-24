import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  applyDocumentTheme,
  DEFAULT_THEME_ID,
  resolveThemeId,
  THEME_STORAGE_KEY,
} from "./themes.js";

const ThemeContext = createContext(null);

function readStoredTheme() {
  try {
    return resolveThemeId(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const stored = readStoredTheme();
    applyDocumentTheme(stored);
    return stored;
  });
  const [pickerOpen, setPickerOpen] = useState(false);

  const setTheme = useCallback((nextId) => {
    const resolved = applyDocumentTheme(nextId);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, resolved);
    } catch {
      /* ignore quota / private mode */
    }
    setThemeState(resolved);
  }, []);

  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      pickerOpen,
      openPicker,
      closePicker,
    }),
    [theme, setTheme, pickerOpen, openPicker, closePicker],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
