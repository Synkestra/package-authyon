import type { BffSessionRecord, BffSessionStore } from "./contracts";

/** Single-process test/development store. Supply a shared store in production. */
export function createMemoryBffSessionStore(): BffSessionStore {
  const sessions = new Map<string, BffSessionRecord>();

  function read(key: string): BffSessionRecord | null {
    const session = sessions.get(key);
    if (!session) return null;
    if (Math.min(session.expiresAt, session.idleExpiresAt) <= Date.now()) {
      sessions.delete(key);
      return null;
    }
    return structuredClone(session);
  }

  return {
    async read(key) {
      return read(key);
    },
    async compareAndSwap(key, expectedRevision, next) {
      // No await between read and write: this is atomic within this process.
      if ((read(key)?.revision ?? null) !== expectedRevision) return false;
      if (next) {
        if (expectedRevision === null) {
          for (const sessionKey of sessions.keys()) read(sessionKey);
        }
        sessions.set(key, structuredClone(next));
      } else {
        sessions.delete(key);
      }
      return true;
    },
  };
}
