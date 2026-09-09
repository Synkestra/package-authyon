import { createHash, randomBytes } from "node:crypto";
import { BffSessionError, type BffSessionRecord, type BffSessionStore } from "./contracts";

const OPERATION_TIMEOUT_MS = 120_000;
const CONTENTION_TIMEOUT_MS = 2_000;
const CONTENTION_POLL_MS = 20;

export const newSessionSecret = () => randomBytes(32).toString("hex");
export const sessionKey = (id: string, origin: string) =>
  createHash("sha256").update(`${origin}\0${id}`).digest("hex");

export interface BffSessionLease {
  key: string;
  record: BffSessionRecord;
}

export class BffSessionRepository {
  constructor(
    private readonly store: BffSessionStore,
    private readonly origin: string,
  ) {}

  async create(record: BffSessionRecord): Promise<string> {
    const id = newSessionSecret();
    if (!(await this.store.compareAndSwap(sessionKey(id, this.origin), null, record))) {
      throw new BffSessionError("session.creation_failed", 503);
    }
    return id;
  }

  async acquire(id: string): Promise<BffSessionLease> {
    const key = sessionKey(id, this.origin);
    const deadline = Date.now() + CONTENTION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const record = await this.readAvailable(key, deadline);
      const reserved = {
        ...record,
        revision: newSessionSecret(),
        busyUntil: Date.now() + OPERATION_TIMEOUT_MS,
      };
      if (await this.store.compareAndSwap(key, record.revision, reserved))
        return { key, record: reserved };
    }
    throw new BffSessionError("session.busy", 503);
  }

  async inspect(id: string): Promise<BffSessionLease> {
    const key = sessionKey(id, this.origin);
    const record = await this.readAvailable(key, Date.now() + CONTENTION_TIMEOUT_MS);
    return { key, record };
  }

  async touch(lease: BffSessionLease, idleExpiresAt: number): Promise<BffSessionRecord | null> {
    const next = {
      ...lease.record,
      revision: newSessionSecret(),
      idleExpiresAt,
    };
    return (await this.store.compareAndSwap(lease.key, lease.record.revision, next)) ? next : null;
  }

  async removeIfCurrent(lease: BffSessionLease): Promise<boolean> {
    return this.store.compareAndSwap(lease.key, lease.record.revision, null);
  }

  async release(lease: BffSessionLease): Promise<void> {
    if (lease.record.busyUntil === null || lease.record.busyUntil <= Date.now()) {
      await this.remove(lease);
      throw new BffSessionError("session.interrupted", 503, true);
    }
    const next = { ...lease.record, revision: newSessionSecret(), busyUntil: null };
    if (!(await this.store.compareAndSwap(lease.key, lease.record.revision, next))) {
      throw new BffSessionError("session.changed", 401, true);
    }
  }

  async remove(lease: BffSessionLease): Promise<void> {
    if (!(await this.removeIfCurrent(lease))) {
      throw new BffSessionError("session.changed", 401, true);
    }
  }

  private async readAvailable(key: string, deadline: number): Promise<BffSessionRecord> {
    while (Date.now() < deadline) {
      const record = await this.store.read(key);
      if (!record) throw new BffSessionError("session.missing", 401, true);
      if (Math.min(record.expiresAt, record.idleExpiresAt) <= Date.now()) {
        if (await this.store.compareAndSwap(key, record.revision, null)) {
          throw new BffSessionError("session.expired", 401, true);
        }
        continue;
      }
      if (record.busyUntil === null) return record;
      if (record.busyUntil <= Date.now()) {
        if (await this.store.compareAndSwap(key, record.revision, null)) {
          throw new BffSessionError("session.interrupted", 503, true);
        }
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, CONTENTION_POLL_MS));
    }
    throw new BffSessionError("session.busy", 503);
  }
}
