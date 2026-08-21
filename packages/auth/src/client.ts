import { AuthyonError } from "./errors";
import { defaultStorage } from "./storage";
import type {
  Activity,
  AuthEvent,
  AuthStateListener,
  AuthenticatorSetup,
  AuthyonClientOptions,
  CreateOrganizationParams,
  IntrospectResult,
  InviteMemberParams,
  LoginParams,
  LoginResult,
  OrganizationMember,
  PageParams,
  RegisterParams,
  Role,
  Session,
  SessionInfo,
  Organization,
  SsoProvider,
  TokenStorage,
  TwoFactorChallenge,
  TwoFactorMethod,
  TwoFactorVerifyParams,
  TwoFactorStatus,
  User,
  ValidateResult,
  WebAuthnAssertion,
  WebAuthnCeremonyStart,
  WebAuthnCredential,
} from "./types";

const DEFAULT_BASE_URL = "https://api.authyon.com";
/** Refresh this many ms before the access token actually expires. */
const EXPIRY_SKEW_MS = 30_000;

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE" | "PATCH";
  body?: unknown;
  /** Attach the bearer access token (with transparent refresh + one retry on 401). */
  bearer?: boolean;
  headers?: Record<string, string>;
}

/**
 * Wire shape shared by every endpoint that mints a session (`/auth/login`,
 * `/auth/2fa/verify`, `/auth/refresh`, `/auth/switch-tenant`,
 * `/auth/webauthn/login/finish`, `/auth/sso/exchange`): tokens live under
 * `tokens`, not at the top level, and `twoFactor` (not `twoFactorRequired`)
 * signals a pending challenge — `null`/absent when none is required.
 */
interface LoginLikeResponse {
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
  twoFactor?: Record<string, unknown> | null;
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
    if (!options.envKey)
      throw new Error("Authyon: `envKey` is required (pk_live_... / pk_test_...)");
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

  private setSession(
    raw: {
      tokens: { accessToken: string; refreshToken: string; expiresIn: number };
      user?: Record<string, unknown>;
    },
    event: AuthEvent["type"],
  ): Session {
    const session: Session = {
      ...raw.tokens,
      user: raw.user ? normalizeUser(raw.user) : undefined,
      expiresAt: Date.now() + raw.tokens.expiresIn * 1000,
    };
    this.storage.set(session);
    this.emit(event === "signed_out" ? { type: "signed_out" } : { type: event, session });
    return session;
  }

  private clearSession(): void {
    this.storage.clear();
    this.emit({ type: "signed_out" });
  }

  /**
   * `/auth/login` and the other endpoints that mint a session don't return
   * a `user` object on the wire — only `tokens` (plus `twoFactor`, when a
   * challenge is required). Fetch the profile right after so callers get a
   * fully-populated `session.user` without an extra manual round trip.
   * Best-effort: keeps the session usable even if this fetch fails.
   */
  private async hydrateUser(session: Session): Promise<Session> {
    try {
      const user = await this.user.me();
      const hydrated: Session = { ...session, user };
      this.storage.set(hydrated);
      return hydrated;
    } catch {
      return session;
    }
  }

  // ── HTTP core ────────────────────────────────────────────────────────────

  private async request<T>(
    path: string,
    options: RequestOptions = {},
    isRetry = false,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "X-Authyon-Environment": this.envKey,
      ...options.headers,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.bearer) {
      const token = await this.getAccessToken();
      if (!token)
        throw new AuthyonError(401, { code: "auth.not_authenticated", title: "Not authenticated" });
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (
      response.status === 401 &&
      options.bearer &&
      this.autoRefresh &&
      !isRetry &&
      this.getSession()
    ) {
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
   * 2FA challenge to complete via `verifyTwoFactor()`.
   */
  async login(params: LoginParams): Promise<LoginResult> {
    const { organizationSlug, ...rest } = params;
    const body = organizationSlug ? { ...rest, tenantSlug: organizationSlug } : rest;
    const data = await this.request<LoginLikeResponse>("/auth/login", { method: "POST", body });
    if (data.twoFactor) {
      return { twoFactorRequired: true, ...data.twoFactor } as TwoFactorChallenge;
    }
    const session = await this.hydrateUser(this.setSession({ tokens: data.tokens }, "signed_in"));
    return { twoFactorRequired: false, session };
  }

  /** POST /auth/2fa/verify — redeems a 2FA challenge from `login()` and stores the session. */
  async verifyTwoFactor(params: TwoFactorVerifyParams): Promise<Session> {
    const data = await this.request<LoginLikeResponse>("/auth/2fa/verify", {
      method: "POST",
      body: params,
    });
    return this.hydrateUser(this.setSession({ tokens: data.tokens }, "signed_in"));
  }

  /** POST /auth/refresh — rotates the single-use refresh token (single-flight). */
  async refresh(): Promise<Session> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const current = this.getSession();
    if (!current)
      throw new AuthyonError(401, { code: "auth.not_authenticated", title: "Not authenticated" });

    this.refreshInFlight = this.request<LoginLikeResponse>("/auth/refresh", {
      method: "POST",
      body: { refreshToken: current.refreshToken },
    })
      .then((data) =>
        this.setSession(
          { tokens: data.tokens, user: current.user as unknown as Record<string, unknown> },
          "refreshed",
        ),
      )
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
          await this.request("/auth/logout", {
            method: "POST",
            body: { refreshToken: session.refreshToken },
          });
        }
      } catch {
        /* revoke best-effort — always clear local state */
      }
    }
    this.clearSession();
  }

  // ── Passwordless (passkey) login ─────────────────────────────────────────

  readonly webauthn = {
    /** POST /auth/webauthn/login/start — begins a passkey sign-in. */
    loginStart: (email?: string): Promise<WebAuthnCeremonyStart> =>
      this.request("/auth/webauthn/login/start", { method: "POST", body: { email } }),

    /**
     * POST /auth/webauthn/login/finish — completes the passkey ceremony and
     * stores the session.
     */
    loginFinish: (assertion: WebAuthnAssertion): Promise<Session> =>
      this.request<LoginLikeResponse>("/auth/webauthn/login/finish", {
        method: "POST",
        body: assertion,
      })
        .then((data) => this.setSession({ tokens: data.tokens }, "signed_in"))
        .then((session) => this.hydrateUser(session)),
  };

  // ── Social sign-in (SSO) ─────────────────────────────────────────────────

  readonly sso = {
    /** GET /auth/sso/providers — providers enabled for this environment. */
    providers: (): Promise<SsoProvider[]> => this.request("/auth/sso/providers"),

    /**
     * Builds the URL to redirect the browser to in order to start a
     * provider's sign-in flow (`GET /auth/sso/{provider}/start`). Navigate
     * to it directly — e.g. `window.location.href = client.sso.startUrl(...)`.
     */
    startUrl: (
      provider: string,
      params: { redirectUri: string; state?: string; mode?: string },
    ): string => {
      const query = new URLSearchParams({ redirect_uri: params.redirectUri });
      if (params.state) query.set("state", params.state);
      if (params.mode) query.set("mode", params.mode);
      return `${this.baseUrl}/auth/sso/${encodeURIComponent(provider)}/start?${query}`;
    },

    /**
     * POST /auth/sso/exchange — swaps the one-time code from the provider
     * callback for tokens and stores the session.
     */
    exchange: (code: string): Promise<Session> =>
      this.request<LoginLikeResponse>("/auth/sso/exchange", { method: "POST", body: { code } })
        .then((data) => this.setSession({ tokens: data.tokens }, "signed_in"))
        .then((session) => this.hydrateUser(session)),
  };

  // ── User ─────────────────────────────────────────────────────────────────

  readonly user = {
    /** GET /auth/me — fresh profile of the current user. */
    me: (): Promise<User> =>
      this.request<Record<string, unknown>>("/auth/me", { bearer: true }).then(normalizeUser),

    /** GET /auth/sessions — active refresh-token sessions with device/IP data. */
    sessions: (): Promise<SessionInfo[]> => this.request("/auth/sessions", { bearer: true }),

    /** GET /auth/me/activities — recent account activity for the current user. */
    activities: (params: PageParams = {}): Promise<Activity[]> =>
      this.request(`/auth/me/activities?${toQuery(params)}`, { bearer: true }),

    /**
     * Revokes a single session by id (e.g. one entry from `sessions()`),
     * signing that device out without affecting the current one.
     *
     * ⚠️ Not directly confirmed against the published API reference at the
     * time this SDK was written — `DELETE /auth/sessions/{id}` follows the
     * REST convention the rest of the documented API uses, but verify it
     * against the Authyon dashboard/API reference before relying on it. If
     * the endpoint differs, override via a raw call to your own backend.
     */
    revokeSession: (sessionId: string): Promise<void> =>
      this.request(`/auth/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        bearer: true,
      }),

    /** POST /auth/password-reset/request — always resolves (no account enumeration). */
    requestPasswordReset: (email: string): Promise<void> =>
      this.request("/auth/password-reset/request", { method: "POST", body: { email } }),

    /** POST /auth/password-reset/confirm — sets a new password and revokes all refresh tokens. */
    confirmPasswordReset: (token: string, newPassword: string): Promise<void> =>
      this.request("/auth/password-reset/confirm", {
        method: "POST",
        body: { token, newPassword },
      }),
  };

  // ── Organization ─────────────────────────────────────────────────────────

  readonly organization = {
    /** GET /auth/tenants — all organization memberships. */
    list: (): Promise<Organization[]> => this.request("/auth/tenants", { bearer: true }),

    /**
     * POST /auth/tenants — creates an organization owned by the signed-in
     * user (only available when self-service organization creation is
     * enabled for the environment).
     */
    create: (params: CreateOrganizationParams = {}): Promise<Organization> =>
      this.request("/auth/tenants", { method: "POST", bearer: true, body: params }),

    /** GET /auth/tenants/{organizationId} — fetch one of the user's organizations by id. */
    get: (organizationId: string): Promise<Organization> =>
      this.request(`/auth/tenants/${encodeURIComponent(organizationId)}`, { bearer: true }),

    /**
     * PATCH /auth/tenants/{organizationId} — renames the organization.
     * Requires the `tenants:manage` custom permission on it.
     */
    rename: (organizationId: string, name: string): Promise<Organization> =>
      this.request(`/auth/tenants/${encodeURIComponent(organizationId)}`, {
        method: "PATCH",
        bearer: true,
        body: { name },
      }),

    /** POST /auth/switch-tenant — issues a fresh token scoped to the new organization. */
    switch: (organizationSlug: string): Promise<Session> =>
      this.request<LoginLikeResponse>("/auth/switch-tenant", {
        method: "POST",
        bearer: true,
        body: { tenantSlug: organizationSlug },
      })
        .then((data) => this.setSession({ tokens: data.tokens }, "refreshed"))
        .then((session) => this.hydrateUser(session)),

    /** The organization the current session is scoped to, from the cached session — no network call. */
    current: (): Organization | null => this.getSession()?.user?.activeOrganization ?? null,

    members: {
      /** GET /auth/tenants/{organizationId}/members — list an organization's members. */
      list: (organizationId: string, params: PageParams = {}): Promise<OrganizationMember[]> =>
        this.request(
          `/auth/tenants/${encodeURIComponent(organizationId)}/members?${toQuery(params)}`,
          { bearer: true },
        ),

      /** POST /auth/tenants/{organizationId}/members — invite a member by e-mail. */
      invite: (organizationId: string, params: InviteMemberParams): Promise<void> =>
        this.request(`/auth/tenants/${encodeURIComponent(organizationId)}/members`, {
          method: "POST",
          bearer: true,
          body: params,
        }),

      /** DELETE /auth/tenants/{organizationId}/members/{userId} — remove a member. */
      remove: (organizationId: string, userId: string): Promise<void> =>
        this.request(
          `/auth/tenants/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
          { method: "DELETE", bearer: true },
        ),
    },

    roles: {
      /** GET /auth/tenants/{organizationId}/roles — roles available in the organization. */
      list: (organizationId: string): Promise<Role[]> =>
        this.request(`/auth/tenants/${encodeURIComponent(organizationId)}/roles`, {
          bearer: true,
        }),
    },
  };

  // ── Two-factor management (authenticated) ────────────────────────────────

  readonly twoFactor = {
    /** GET /auth/2fa/status — enrolled methods and recovery code count. */
    status: (): Promise<TwoFactorStatus> => this.request("/auth/2fa/status", { bearer: true }),

    /** POST /auth/2fa/resend-email — resends the code for an in-flight login challenge. */
    resendEmail: (challengeToken: string): Promise<void> =>
      this.request("/auth/2fa/resend-email", { method: "POST", body: { challengeToken } }),

    /** POST /auth/2fa/authenticator/setup — returns secret, QR SVG and otpauth URI. */
    setupAuthenticator: (): Promise<AuthenticatorSetup> =>
      this.request("/auth/2fa/authenticator/setup", { method: "POST", bearer: true }),

    /** POST /auth/2fa/authenticator/confirm — returns 10 single-use recovery codes. */
    confirmAuthenticator: (code: string): Promise<{ recoveryCodes: string[] }> =>
      this.request("/auth/2fa/authenticator/confirm", {
        method: "POST",
        bearer: true,
        body: { code },
      }),

    /**
     * POST /auth/2fa/email/enable — two-step opt-in for email-based OTP.
     * Call without `code` to receive one by e-mail, then call again with
     * that code to confirm enrolment.
     */
    enableEmail: (code?: string): Promise<void> =>
      this.request("/auth/2fa/email/enable", { method: "POST", bearer: true, body: { code } }),

    /** POST /auth/2fa/disable — turns off a specific 2FA method (requires current password). */
    disable: (method: TwoFactorMethod, currentPassword: string): Promise<void> =>
      this.request("/auth/2fa/disable", {
        method: "POST",
        bearer: true,
        body: { method, currentPassword },
      }),

    /**
     * POST /auth/2fa/recovery-codes/regenerate — rotates the 10 single-use
     * recovery codes (requires current password).
     */
    regenerateRecoveryCodes: (currentPassword: string): Promise<{ recoveryCodes: string[] }> =>
      this.request("/auth/2fa/recovery-codes/regenerate", {
        method: "POST",
        bearer: true,
        body: { currentPassword },
      }),

    webauthn: {
      /** POST /auth/2fa/webauthn/register/start — begins passkey enrolment for 2FA. */
      registerStart: (): Promise<WebAuthnCeremonyStart> =>
        this.request("/auth/2fa/webauthn/register/start", { method: "POST", bearer: true }),

      /** POST /auth/2fa/webauthn/register/finish — finishes passkey enrolment. */
      registerFinish: (
        ceremonyToken: string,
        attestationJson: string,
        nickname?: string,
      ): Promise<WebAuthnCredential> =>
        this.request("/auth/2fa/webauthn/register/finish", {
          method: "POST",
          bearer: true,
          body: { ceremonyToken, attestationJson, nickname },
        }),

      /** GET /auth/2fa/webauthn/credentials — the caller's registered passkeys. */
      credentials: (): Promise<WebAuthnCredential[]> =>
        this.request("/auth/2fa/webauthn/credentials", { bearer: true }),

      /** PATCH /auth/2fa/webauthn/credentials/{id} — renames a passkey. */
      renameCredential: (id: string, nickname: string): Promise<WebAuthnCredential> =>
        this.request(`/auth/2fa/webauthn/credentials/${encodeURIComponent(id)}`, {
          method: "PATCH",
          bearer: true,
          body: { nickname },
        }),

      /** DELETE /auth/2fa/webauthn/credentials/{id} — removes a passkey (requires current password). */
      removeCredential: (id: string, currentPassword: string): Promise<void> =>
        this.request(`/auth/2fa/webauthn/credentials/${encodeURIComponent(id)}`, {
          method: "DELETE",
          bearer: true,
          body: { currentPassword },
        }),

      /**
       * POST /auth/2fa/webauthn/assertion/start — fetches WebAuthn assertion
       * options for an in-flight login challenge (2FA method `"webauthn"`).
       */
      assertionStart: (challengeToken: string): Promise<WebAuthnCeremonyStart> =>
        this.request("/auth/2fa/webauthn/assertion/start", {
          method: "POST",
          body: { challengeToken },
        }),
    },
  };

  // ── Token verification ───────────────────────────────────────────────────

  /** POST /auth/introspect — lightweight token introspection. */
  async introspect(token?: string): Promise<IntrospectResult> {
    const accessToken = token ?? (await this.getAccessToken());
    return this.request("/auth/introspect", { method: "POST", body: { token: accessToken } });
  }

  /** POST /auth/validate — recommended: cross-checks DB state, returns user + organization. */
  async validate(token?: string): Promise<ValidateResult> {
    const accessToken = token ?? (await this.getAccessToken());
    const raw = await this.request<Record<string, unknown>>("/auth/validate", {
      method: "POST",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });
    return {
      user: normalizeUser(raw.user as Record<string, unknown>),
      organization: (raw.organization ?? raw.tenant ?? null) as Organization | null,
    };
  }
}

/** Maps the API's tenant-based wire fields to the SDK's organization naming. */
function normalizeUser(raw: Record<string, unknown>): User {
  const { tenants, activeTenant, ...rest } = raw;
  return {
    ...(rest as unknown as User),
    organizations: (raw.organizations ?? tenants) as Organization[] | undefined,
    activeOrganization: (raw.activeOrganization ?? activeTenant ?? null) as Organization | null,
  };
}

/** Convenience factory: `const authyon = createClient({ envKey: "pk_live_..." })`. */
export function createClient(options: AuthyonClientOptions): AuthyonClient {
  return new AuthyonClient(options);
}

function toQuery(params: object): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query.toString();
}
