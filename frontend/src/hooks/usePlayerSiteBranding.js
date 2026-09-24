import logoWide from "../assets/logo.png";
import logoMark from "../assets/logo-mark.png";

const defaultResolved = Object.freeze({
  navbarWide: logoWide,
  navbarCompact: logoMark,
  loadingLogo: logoMark,
});

/**
 * Bundled AsmatBet mark for header + home loading overlay.
 */
export function usePlayerSiteBranding() {
  return defaultResolved;
}
