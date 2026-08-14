import type { Session, TokenStorage } from "./types";

const STORAGE_KEY = "authyon.session";

/** Keeps the session in memory only (lost on page reload). */
export function memoryStorage(): TokenStorage {
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
export function localStorageAdapter(key: string = STORAGE_KEY): TokenStorage {
  return {
    get() {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as Session) : null;
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

export function defaultStorage(): TokenStorage {
  if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
    return localStorageAdapter();
  }
  return memoryStorage();
}
