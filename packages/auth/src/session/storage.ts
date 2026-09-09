import type { Session, TokenStorage } from "../contracts/auth";

const STORAGE_KEY = "authyon.session";

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Session>;
  return (
    typeof candidate.accessToken === "string" &&
    candidate.accessToken.length > 0 &&
    typeof candidate.refreshToken === "string" &&
    candidate.refreshToken.length > 0 &&
    typeof candidate.expiresIn === "number" &&
    Number.isFinite(candidate.expiresIn) &&
    candidate.expiresIn > 0 &&
    typeof candidate.expiresAt === "number" &&
    Number.isFinite(candidate.expiresAt)
  );
}

/** Keeps the session in memory only (lost on page reload). */
export function createMemoryStorage(): TokenStorage {
  let session: Session | null = null;
  return {
    get: () => session,
    set: (s) => {
      session = s;
    },
    clear: () => {
      session = null;
    },
  };
}

/** Persists the session in `localStorage` under a namespaced key. */
export function createLocalStorage(key: string = STORAGE_KEY): TokenStorage {
  return {
    get() {
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (isSession(parsed)) return parsed;
        window.localStorage.removeItem(key);
        return null;
      } catch {
        return null;
      }
    },
    set(session) {
      try {
        window.localStorage.setItem(key, JSON.stringify(session));
      } catch {
        /* quota / privacy mode — session still works in memory for this tab */
      }
    },
    clear() {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

export function createDefaultStorage(): TokenStorage {
  return createMemoryStorage();
}
