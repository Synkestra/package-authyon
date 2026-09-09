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
      const record = await this.store.read(key);
      if (!record) throw new BffSessionError("session.missing", 401, true);
      if (Math.min(record.expiresAt, record.idleExpiresAt) <= Date.now()) {
        await this.store.compareAndSwap(key, record.revision, null);
        throw new BffSessionError("session.expired", 401, true);
      }
      if (record.busyUntil !== null) {
        if (record.busyUntil <= Date.now()) {
          await this.store.compareAndSwap(key, record.revision, null);
          throw new BffSessionError("session.interrupted", 503, true);
        }
        await new Promise((resolve) => setTimeout(resolve, CONTENTION_POLL_MS));
        continue;
      }
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
    if (!(await this.store.compareAndSwap(lease.key, lease.record.revision, null))) {
      throw new BffSessionError("session.changed", 401, true);
    }
  }
}
