export const PLAYER_ROLE = "PLAYER";
export const EXPIRED_TOKEN_MESSAGE = "Invalid or expired token";

let sessionLogoutPending = false;

function getStoredTokenRaw() {
  return localStorage.getItem("token") || sessionStorage.getItem("token");
}

/** JWT exp check without verifying signature (client-side stale-session guard). */
export function isStoredTokenExpired() {
  const token = getStoredTokenRaw();
  if (!token) return false;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return true;
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    const exp = Number(payload.exp);
    if (!Number.isFinite(exp)) return false;
    return exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

export function redirectToLoginAfterExpiredSession() {
  if (sessionLogoutPending) return;
  sessionLogoutPending = true;
  clearAuthSession();
  window.location.assign("/login");
}

/** @returns {boolean} true when session was expired and logout was triggered */
export function handleExpiredAuthResponse(res, data) {
  if (res.status === 401 && data?.message === EXPIRED_TOKEN_MESSAGE) {
    redirectToLoginAfterExpiredSession();
    return true;
  }
  return false;
}

export function getStoredUser() {
  const raw = localStorage.getItem("user") || sessionStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function hasStoredAuthToken() {
  return Boolean(
    localStorage.getItem("token") || sessionStorage.getItem("token"),
  );
}

export function isPlayerUser(user) {
  return user?.role === PLAYER_ROLE;
}

export function clearAuthSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");
  window.dispatchEvent(new Event("authSessionUpdated"));
}

export function saveAuthSession({ token, user, remember: _remember = true }) {
  // Always use localStorage so auth survives MRX same-tab returns and new tabs.
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");
  window.dispatchEvent(new Event("authSessionUpdated"));
}

/** Drop sessions for staff/admin accounts that cannot use the player site. */
export function enforcePlayerSession() {
  if (!hasStoredAuthToken()) return;
  if (isStoredTokenExpired()) {
    clearAuthSession();
    return;
  }
  const user = getStoredUser();
  if (!isPlayerUser(user)) {
    clearAuthSession();
  }
}
