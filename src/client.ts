import { AuthyonError } from "./errors";
import { defaultStorage } from "./storage";
import type {
  AuthEvent,
  AuthStateListener,
  AuthenticatorSetup,
  AuthyonClientOptions,
  IntrospectResult,
  LoginParams,
  LoginResult,
  RegisterParams,
  Session,
  SessionInfo,
  Tenant,
  TokenStorage,
  TwoFactorChallengeParams,
  TwoFactorStatus,
  User,
  ValidateResult,
} from "./types";

const DEFAULT_BASE_URL = "https://api.authyon.com";
/** Refresh this many ms before the access token actually expires. */
const EXPIRY_SKEW_MS = 30_000;

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** Attach the bearer access token (with transparent refresh + one retry on 401). */
  bearer?: boolean;
  headers?: Record<string, string>;
}

export class AuthyonClient {
  private readonly envKey: string;
  private readonly baseUrl: string;
  private readonly storage: TokenStorage;
  private readonly autoRefresh: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly listeners = new Set<AuthStateListener>();
  private refreshInFlight: Promise<Session> | null = null;

  constructor(options: AuthyonClientOptions) {
    if (!options.envKey) throw new Error("Authyon: `envKey` is required (pk_live_... / pk_test_...)");
    this.envKey = options.envKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.storage = options.storage ?? defaultStorage();
    this.autoRefresh = options.autoRefresh ?? true;
    this.fetchImpl = options.fetch ?? fetch.bind(globalThis);
  }

  // ── Session state ────────────────────────────────────────────────────────

  /** Current persisted session, or null when signed out. */
  getSession(): Session | null {
    return this.storage.get();
  }

  isAuthenticated(): boolean {
    return this.getSession() !== null;
  }

  /**
   * Returns a valid access token, refreshing it transparently when it is
   * expired or about to expire. Returns null when signed out.
   */
  async getAccessToken(): Promise<string | null> {
    const session = this.getSession();
    if (!session) return null;
    if (this.autoRefresh && Date.now() >= session.expiresAt - EXPIRY_SKEW_MS) {
      try {
        return (await this.refresh()).accessToken;
      } catch {
        return null;
      }
    }
    return session.accessToken;
  }

  /** Subscribe to sign-in / refresh / sign-out events. Returns an unsubscribe fn. */
  onAuthStateChange(listener: AuthStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AuthEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private setSession(raw: { accessToken: string; refreshToken: string; expiresIn: number; user?: User }, event: AuthEvent["type"]): Session {
    const session: Session = { ...raw, expiresAt: Date.now() + raw.expiresIn * 1000 };
    this.storage.set(session);
    this.emit(event === "signed_out" ? { type: "signed_out" } : { type: event, session });
    return session;
  }

  private clearSession(): void {
    this.storage.clear();
    this.emit({ type: "signed_out" });
  }

  // ── HTTP core ────────────────────────────────────────────────────────────

  private async request<T>(path: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
    const headers: Record<string, string> = {
      "X-Authyon-Env": this.envKey,
      ...options.headers,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.bearer) {
      const token = await this.getAccessToken();
      if (!token) throw new AuthyonError(401, { code: "auth.not_authenticated", title: "Not authenticated" });
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 401 && options.bearer && this.autoRefresh && !isRetry && this.getSession()) {
      try {
        await this.refresh();
      } catch {
        this.clearSession();
        throw await this.toError(response);
      }
      return this.request<T>(path, options, true);
    }

    if (!response.ok) throw await this.toError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async toError(response: Response): Promise<AuthyonError> {
    let body: Record<string, string> = {};
    try {
      body = await response.json();
    } catch {
      /* non-JSON error body */
    }
    return new AuthyonError(response.status, body);
  }

  // ── Auth flows ───────────────────────────────────────────────────────────

  /** POST /auth/register — creates a new user (rate-limited to 20/hour per IP). */
  async register(params: RegisterParams): Promise<{ id: string }> {
    return this.request("/auth/register", { method: "POST", body: params });
  }

  /**
   * POST /auth/login — authenticates and stores the session, or returns a
   * 2FA challenge to complete via `completeTwoFactorChallenge()`.
   */
  async login(params: LoginParams): Promise<LoginResult> {
    const data = await this.request<Record<string, unknown>>("/auth/login", { method: "POST", body: params });
    if (data.twoFactorRequired) {
      return data as unknown as LoginResult;
    }
    const session = this.setSession(data as never, "signed_in");
    return { twoFactorRequired: false, session };
  }

  /** POST /auth/2fa/challenge — completes a 2FA login and stores the session. */
  async completeTwoFactorChallenge(params: TwoFactorChallengeParams): Promise<Session> {
    const data = await this.request<never>("/auth/2fa/challenge", { method: "POST", body: params });
    return this.setSession(data, "signed_in");
  }

  /** POST /auth/refresh — rotates the single-use refresh token (single-flight). */
  async refresh(): Promise<Session> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const current = this.getSession();
    if (!current) throw new AuthyonError(401, { code: "auth.not_authenticated", title: "Not authenticated" });

    this.refreshInFlight = this.request<never>("/auth/refresh", {
      method: "POST",
      body: { refreshToken: current.refreshToken },
    })
      .then((data) => this.setSession({ user: current.user, ...(data as object) } as never, "refreshed"))
      .catch((error) => {
        // A rejected rotation means the refresh token is spent/revoked.
        if (error instanceof AuthyonError && (error.status === 401 || error.status === 403)) {
          this.clearSession();
        }
        throw error;
      })
      .finally(() => {
        this.refreshInFlight = null;
      });
    return this.refreshInFlight;
  }

  /**
   * POST /auth/logout — revokes the current refresh token and clears local
   * state. Pass `{ everywhere: true }` to revoke every session for the user.
   */
  async logout(options: { everywhere?: boolean } = {}): Promise<void> {
    const session = this.getSession();
    if (session) {
      try {
        if (options.everywhere) {
          await this.request("/auth/logout", { method: "POST", bearer: true });
        } else {
          await this.request("/auth/logout", { method: "POST", body: { refreshToken: session.refreshToken } });
        }
      } catch {
        /* revoke best-effort — always clear local state */
      }
    }
    this.clearSession();
  }

  // ── Current user ─────────────────────────────────────────────────────────

  /** GET /auth/me — fresh profile of the current user. */
  async me(): Promise<User> {
    return this.request("/auth/me", { bearer: true });
  }

  /** GET /auth/tenants — all tenant memberships. */
  async tenants(): Promise<Tenant[]> {
    return this.request("/auth/tenants", { bearer: true });
  }

  /** POST /auth/switch-tenant — issues a fresh token scoped to the new tenant. */
  async switchTenant(tenantSlug: string): Promise<Session> {
    const data = await this.request<never>("/auth/switch-tenant", {
      method: "POST",
      bearer: true,
      body: { tenantSlug },
    });
    return this.setSession(data, "refreshed");
  }

  /** GET /auth/sessions — active refresh-token sessions with device/IP data. */
  async sessions(): Promise<SessionInfo[]> {
    return this.request("/auth/sessions", { bearer: true });
  }

  // ── Password reset ───────────────────────────────────────────────────────

  /** POST /auth/password-reset/request — always resolves (no account enumeration). */
  async requestPasswordReset(email: string): Promise<void> {
    await this.request("/auth/password-reset/request", { method: "POST", body: { email } });
  }

  /** POST /auth/password-reset/confirm — sets a new password and revokes all refresh tokens. */
  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    await this.request("/auth/password-reset/confirm", { method: "POST", body: { token, newPassword } });
  }

  // ── Two-factor management (authenticated) ────────────────────────────────

  readonly twoFactor = {
    /** GET /auth/2fa/status — enrolled methods and recovery code count. */
    status: (): Promise<TwoFactorStatus> => this.request("/auth/2fa/status", { bearer: true }),

    /** POST /auth/2fa/authenticator/setup — returns secret, QR SVG and otpauth URI. */
    setupAuthenticator: (): Promise<AuthenticatorSetup> =>
      this.request("/auth/2fa/authenticator/setup", { method: "POST", bearer: true }),

    /** POST /auth/2fa/authenticator/confirm — returns 10 single-use recovery codes. */
    confirmAuthenticator: (code: string): Promise<{ recoveryCodes: string[] }> =>
      this.request("/auth/2fa/authenticator/confirm", { method: "POST", bearer: true, body: { code } }),

    /**
     * POST /auth/2fa/recovery-codes/regenerate — requires a recent step-up
     * (`X-Authyon-StepUp` cookie set by the API).
     */
    regenerateRecoveryCodes: (): Promise<{ recoveryCodes: string[] }> =>
      this.request("/auth/2fa/recovery-codes/regenerate", { method: "POST", bearer: true }),
  };

  // ── Token verification ───────────────────────────────────────────────────

  /** POST /auth/introspect — lightweight token introspection. */
  async introspect(token?: string): Promise<IntrospectResult> {
    const accessToken = token ?? (await this.getAccessToken());
    return this.request("/auth/introspect", { method: "POST", body: { token: accessToken } });
  }

  /** POST /auth/validate — recommended: cross-checks DB state, returns user + tenant. */
  async validate(token?: string): Promise<ValidateResult> {
    const accessToken = token ?? (await this.getAccessToken());
    return this.request("/auth/validate", {
      method: "POST",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });
  }
}

/** Convenience factory: `const authyon = createClient({ envKey: "pk_live_..." })`. */
export function createClient(options: AuthyonClientOptions): AuthyonClient {
  return new AuthyonClient(options);
}
