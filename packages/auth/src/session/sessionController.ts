import type { AuthyonClient } from "../client/authyonClient";
import type { Session, User } from "../contracts/auth";

export type SessionStatus = "validating" | "authenticated" | "unauthenticated" | "error";

export interface SessionSnapshot {
  status: SessionStatus;
  session: Session | null;
  user: User | null;
  error: unknown | null;
}

export interface SessionControllerOptions {
  /** Refresh before expiration. Defaults to 30 seconds. */
  refreshAheadMs?: number;
}

export type SessionSnapshotListener = () => void;
const SERVER_SNAPSHOT: SessionSnapshot = {
  // The server cannot inspect browser storage. Reporting unauthenticated here
  // makes guards redirect during hydration before a persisted session can be
  // restored and validated on the client.
  status: "validating",
  session: null,
  user: null,
  error: null,
};

/** Framework-agnostic session lifecycle used by the React/Next.js integration. */
export class AuthyonSessionController {
  private snapshot: SessionSnapshot;
  private readonly listeners = new Set<SessionSnapshotListener>();
  private unsubscribeAuth?: () => void;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private validation?: Promise<SessionSnapshot>;
  private readonly refreshAheadMs: number;

  constructor(
    readonly client: AuthyonClient,
    options: SessionControllerOptions = {},
  ) {
    this.refreshAheadMs = options.refreshAheadMs ?? 30_000;
    if (!Number.isFinite(this.refreshAheadMs) || this.refreshAheadMs < 0) {
      throw new Error("Authyon: `refreshAheadMs` must be a non-negative finite number");
    }
    const session = client.getSession();
    this.snapshot = {
      status: session ? "validating" : "unauthenticated",
      session,
      user: session?.user ?? null,
      error: null,
    };
  }

  getSnapshot = (): SessionSnapshot => this.snapshot;
  getServerSnapshot = (): SessionSnapshot => SERVER_SNAPSHOT;

  subscribe = (listener: SessionSnapshotListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): () => void {
    if (!this.unsubscribeAuth) {
      this.unsubscribeAuth = this.client.onAuthStateChange((event) => {
        if (event.type === "signed_out") {
          this.cancelRefresh();
          this.setSnapshot({
            status: "unauthenticated",
            session: null,
            user: null,
            error: null,
          });
          return;
        }
        if (event.type === "session_validated") {
          this.acceptSession(event.session);
          return;
        }
        this.setSnapshot({
          status: "validating",
          session: event.session,
          user: event.session.user ?? null,
          error: null,
        });
        void this.validate();
      });
    }
    void this.validate();
    return () => this.stop();
  }

  stop(): void {
    this.unsubscribeAuth?.();
    this.unsubscribeAuth = undefined;
    this.cancelRefresh();
  }

  validate(): Promise<SessionSnapshot> {
    if (this.validation) return this.validation;
    const localSession = this.client.getSession();
    if (!localSession) {
      this.setSnapshot({
        status: "unauthenticated",
        session: null,
        user: null,
        error: null,
      });
      return Promise.resolve(this.snapshot);
    }
    this.setSnapshot({ ...this.snapshot, status: "validating", error: null });
    this.validation = this.client
      .validateSession()
      .then((session) => {
        if (session) this.acceptSession(session);
        else {
          this.setSnapshot({
            status: "unauthenticated",
            session: null,
            user: null,
            error: null,
          });
        }
        return this.snapshot;
      })
      .catch((error: unknown) => {
        this.setSnapshot({ ...this.snapshot, status: "error", error });
        return this.snapshot;
      })
      .finally(() => {
        this.validation = undefined;
      });
    return this.validation;
  }

  async refreshNow(): Promise<SessionSnapshot> {
    if (!this.client.getSession()) return this.validate();
    try {
      await this.client.refresh();
    } catch (error) {
      if (!this.client.getSession()) return this.validate();
      this.setSnapshot({ ...this.snapshot, status: "error", error });
      return this.snapshot;
    }
    return this.validate();
  }

  private acceptSession(session: Session): void {
    this.setSnapshot({
      status: "authenticated",
      session,
      user: session.user ?? null,
      error: null,
    });
    this.scheduleRefresh(session);
  }

  private scheduleRefresh(session: Session): void {
    this.cancelRefresh();
    const delay = Math.max(1_000, session.expiresAt - Date.now() - this.refreshAheadMs);
    this.refreshTimer = setTimeout(() => void this.refreshNow(), delay);
  }

  private cancelRefresh(): void {
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  private setSnapshot(snapshot: SessionSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
