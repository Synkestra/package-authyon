import { AuthyonError } from "./errors";
import type {
  AuthyonServerClientOptions,
  CreateOrganizationInput,
  Invite,
  InviteInput,
  IntrospectResult,
  Member,
  MemberInput,
  Organization,
  User,
  ValidateResult,
} from "./types";

const DEFAULT_BASE_URL = "https://api.authyon.com";

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Which key authenticates this call — publishable (env) or secret. */
  auth: "env" | "secret";
}

/**
 * Server-side Authyon client: organization/member management (secret key)
 * plus access-token verification (publishable key). Never import this in
 * browser code — the secret key must stay on your server.
 */
export class AuthyonServerClient {
  private readonly envKey?: string;
  private readonly secretKey?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AuthyonServerClientOptions = {}) {
    this.envKey = options.envKey;
    this.secretKey = options.secretKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch.bind(globalThis);
  }

  private async request<T>(path: string, options: RequestOptions): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    if (options.auth === "env") {
      if (!this.envKey) {
        throw new Error(
          "Authyon: `envKey` is required for token verification (pk_live_... / pk_test_...)",
        );
      }
      headers["X-Authyon-Env"] = this.envKey;
    } else {
      if (!this.secretKey) {
        throw new Error(
          "Authyon: `secretKey` is required for organization/member management (sk_live_... / sk_test_...)",
        );
      }
      headers.Authorization = `Bearer ${this.secretKey}`;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      let body: Record<string, string> = {};
      try {
        body = await response.json();
      } catch {
        /* non-JSON error body */
      }
      throw new AuthyonError(response.status, body);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  // ── Token verification (publishable key) ─────────────────────────────────

  /** POST /auth/introspect — lightweight token introspection. */
  introspect(token: string): Promise<IntrospectResult> {
    return this.request("/auth/introspect", { auth: "env", method: "POST", body: { token } });
  }

  /** POST /auth/validate — recommended: cross-checks DB state, catches revocation immediately. */
  async validate(token: string): Promise<ValidateResult> {
    const raw = await this.request<{
      user: User;
      organization?: Organization | null;
      tenant?: Organization | null;
    }>("/auth/validate", { auth: "env", method: "POST", body: { token } });
    return { user: raw.user, organization: raw.organization ?? raw.tenant ?? null };
  }

  // ── Organization management (secret key) ──────────────────────────────────
  //
  // ⚠️ These paths follow the REST convention the rest of the documented
  // Authyon API uses, but the management API reference did not render for
  // us to confirm exact endpoint names/fields at the time this SDK was
  // written. Verify against the Authyon dashboard/API reference before
  // relying on this in production.

  readonly organization = {
    /** POST /tenants — creates an organization. */
    create: (input: CreateOrganizationInput): Promise<Organization> =>
      this.request("/tenants", { auth: "secret", method: "POST", body: input }),

    /** POST /tenants/{slug}/invites — invites a user by e-mail. */
    invite: (organizationSlug: string, input: InviteInput): Promise<Invite> =>
      this.request(`/tenants/${encodeURIComponent(organizationSlug)}/invites`, {
        auth: "secret",
        method: "POST",
        body: input,
      }),
  };

  readonly member = {
    /** POST /tenants/{slug}/members — adds an existing user to an organization. */
    add: (organizationSlug: string, userId: string, input: MemberInput): Promise<Member> =>
      this.request(`/tenants/${encodeURIComponent(organizationSlug)}/members`, {
        auth: "secret",
        method: "POST",
        body: { userId, ...input },
      }),

    /** PATCH /tenants/{slug}/members/{userId} — updates role/scopes for a member. */
    updateScopes: (organizationSlug: string, userId: string, scopes: string[]): Promise<void> =>
      this.request(
        `/tenants/${encodeURIComponent(organizationSlug)}/members/${encodeURIComponent(userId)}`,
        { auth: "secret", method: "PATCH", body: { scopes } },
      ),

    /** DELETE /tenants/{slug}/members/{userId} — revokes a member's access. */
    remove: (organizationSlug: string, userId: string): Promise<void> =>
      this.request(
        `/tenants/${encodeURIComponent(organizationSlug)}/members/${encodeURIComponent(userId)}`,
        { auth: "secret", method: "DELETE" },
      ),
  };
}

/** Convenience factory: `const authyon = createServerClient({ secretKey: "sk_live_..." })`. */
export function createServerClient(options: AuthyonServerClientOptions = {}): AuthyonServerClient {
  return new AuthyonServerClient(options);
}
