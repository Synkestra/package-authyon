import { DEFAULT_BASE_URL } from "../../../../internal/core/config/defaults";
import { ExpiringTokenProvider } from "../../../../internal/core/auth/expiringTokenProvider";
import {
  JsonHttpClient,
  type JsonRequestOptions,
} from "../../../../internal/core/http/jsonHttpClient";
import { createSharedTransport } from "../../../../internal/core/http/transport";
import {
  clientIpHeaders,
  type ClientRequestContext,
} from "../../../../internal/core/http/clientIp";
import type {
  AuditEvent,
  AuthyonServerClientOptions,
  ClientCredentials,
  CreateOrganizationInput,
  CreatePermissionInput,
  CreateUserInput,
  EnvironmentUser,
  IntrospectResult,
  JsonWebKeySet,
  LoginActivity,
  Organization,
  OpenIdConfiguration,
  Paged,
  PaginationOptions,
  Permission,
  PermissionsByRole,
  ReservedPermissions,
  Role,
  RoleInput,
  RoleList,
  TokenResult,
  UpdateOrganizationInput,
  User,
  ValidateResult,
} from "../contracts/server";
import { JwksTokenVerifier, type AuthyonJwksDiscoveryOptions } from "../security/jwksTokenVerifier";

interface RequestOptions extends JsonRequestOptions {
  /** Attach the cached environment access token, minting one first if needed. */
  envBearer?: boolean;
}

/**
 * Server-side Authyon client: environment/tenant administration (OAuth
 * client-credentials) plus access-token verification (publishable key).
 * Never import this in browser code — client secrets must stay on your
 * server.
 */
export class AuthyonServerClient {
  private readonly envKey?: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly transport: ReturnType<typeof createSharedTransport>;
  private readonly http: JsonHttpClient;
  private readonly environmentTokenProvider: ExpiringTokenProvider;

  constructor(options: AuthyonServerClientOptions = {}) {
    this.envKey = options.envKey;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.transport = createSharedTransport({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      allowInsecureHttp: options.allowInsecureHttp,
      timeoutMs: options.timeoutMs,
      httpAdapter: options.httpAdapter,
      httpLogger: options.httpLogger,
      fetch: options.fetch,
    });
    this.http = new JsonHttpClient(this.transport);
    this.environmentTokenProvider = new ExpiringTokenProvider(async () => {
      if (!this.clientId || !this.clientSecret) {
        throw new Error(
          "Authyon: `clientId`/`clientSecret` are required for environment management calls " +
            "(mint a pair in the console, under the environment's OAuth clients).",
        );
      }
      const token = await this.environmentAuth.token({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
      });
      return {
        accessToken: token.access_token,
        expiresAt: Date.now() + token.expires_in * 1000,
      };
    });
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.envBearer) {
      headers.Authorization = `Bearer ${await this.getEnvironmentAccessToken()}`;
    }
    if (this.envKey) headers["X-Authyon-Environment"] = this.envKey;

    return this.http.request<T>(path, { ...options, headers });
  }

  /** Mints (and caches) an environment access token from `clientId`/`clientSecret`. */
  private async getEnvironmentAccessToken(): Promise<string> {
    return this.environmentTokenProvider.getAccessToken();
  }

  // ── Discovery ──────────────────────────────────────────────────────────────

  readonly discovery = {
    /** GET /.well-known/jwks.json — the environment's public signing keys. */
    jwks: (publishableKey?: string): Promise<JsonWebKeySet> =>
      this.request(
        publishableKey
          ? `/.well-known/${encodeURIComponent(publishableKey)}/jwks.json`
          : "/.well-known/jwks.json",
      ),

    /** GET /.well-known/openid-configuration — OIDC discovery document. */
    openidConfiguration: (publishableKey?: string): Promise<OpenIdConfiguration> =>
      this.request(
        publishableKey
          ? `/.well-known/${encodeURIComponent(publishableKey)}/openid-configuration`
          : "/.well-known/openid-configuration",
      ),
  };

  /** Discovers Authyon's trusted issuer/JWKS and creates a cached local access-token verifier. */
  async createJwksTokenVerifier(options: AuthyonJwksDiscoveryOptions): Promise<JwksTokenVerifier> {
    const { publishableKey, issuer, ...verifierOptions } = options;
    const configuration = await this.discovery.openidConfiguration(publishableKey);
    if (issuer && configuration.issuer !== issuer) {
      throw new Error("Authyon: discovered JWT issuer does not match the configured issuer");
    }
    return new JwksTokenVerifier({
      ...verifierOptions,
      issuer: issuer ?? configuration.issuer,
      jwksUri: configuration.jwks_uri,
    });
  }

  // ── Token verification ────────────────────────────────────────────────────
  //
  // Per RFC 7662 §2.1, the CALLER must authenticate here too — the token
  // being inspected sits in the body, but the request itself needs an
  // environment (or tenant) client-credentials bearer token, same as
  // `environment.*`. Confirmed against the live API: calling either
  // endpoint with only the `X-Authyon-Environment` header (no bearer)
  // returns 401 with `WWW-Authenticate: Bearer`.

  /** POST /auth/introspect — lightweight token introspection (RFC 7662). */
  introspect(token: string, context?: ClientRequestContext): Promise<IntrospectResult> {
    return this.request("/auth/introspect", {
      method: "POST",
      envBearer: true,
      body: { token },
      headers: clientIpHeaders(context),
    });
  }

  /** POST /auth/validate — recommended: cross-checks DB state, catches revocation immediately. */
  async validate(token: string, context?: ClientRequestContext): Promise<ValidateResult> {
    const raw = await this.request<{
      valid: boolean;
      reason?: string | null;
      profile: User | null;
    }>("/auth/validate", {
      method: "POST",
      envBearer: true,
      body: { token },
      headers: clientIpHeaders(context),
    });
    return { valid: raw.valid, reason: raw.reason ?? null, user: raw.profile };
  }

  // ── Environment-level machine auth ───────────────────────────────────────

  readonly environmentAuth = {
    /** POST /env/oauth/token — exchanges environment client credentials for an access token. */
    token: (credentials: ClientCredentials): Promise<TokenResult> =>
      this.request("/env/oauth/token", {
        method: "POST",
        body: {
          grant_type: "client_credentials",
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
        },
      }),
  };

  // ── Tenant-level machine auth ─────────────────────────────────────────────

  readonly tenantAuth = {
    /** POST /tenant/oauth/token — exchanges a tenant's client credentials for a scoped access token. */
    token: (credentials: ClientCredentials): Promise<TokenResult> =>
      this.request("/tenant/oauth/token", {
        method: "POST",
        body: {
          grant_type: "client_credentials",
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
        },
      }),
  };

  /**
   * Scopes a client to a single tenant's OAuth credentials — mints and
   * caches its access token independently of the environment plane. Use
   * this for the `TenantManagement` endpoints (`/tenant/...`), which act on
   * "the token's tenant" rather than one you pass by id.
   */
  tenant(credentials: ClientCredentials): TenantScopedClient {
    return new TenantScopedClient(this, credentials);
  }

  // ── Environment management (users, tenants, roles, permissions, audit) ───

  readonly environment = {
    users: {
      /** GET /env/users — paginated list of users in the environment. */
      list: (
        params: { search?: string } & PaginationOptions = {},
      ): Promise<Paged<EnvironmentUser>> =>
        this.request("/env/users", { envBearer: true, query: params }),

      /** POST /env/users — create a user in the environment; returns only the new id. */
      create: (input: CreateUserInput): Promise<{ id: string }> =>
        this.request("/env/users", { method: "POST", envBearer: true, body: input }),

      /** GET /env/users/{userId} — fetch an environment user by id. */
      get: (userId: string): Promise<EnvironmentUser> =>
        this.request(`/env/users/${encodeURIComponent(userId)}`, { envBearer: true }),

      /** POST /env/users/{userId}/roles — grant a role to an environment user. */
      assignRole: (userId: string, role: string): Promise<void> =>
        this.request(`/env/users/${encodeURIComponent(userId)}/roles`, {
          method: "POST",
          envBearer: true,
          body: { role },
        }),

      /** DELETE /env/users/{userId}/roles/{role} — revoke a role from an environment user. */
      removeRole: (userId: string, role: string): Promise<void> =>
        this.request(`/env/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(role)}`, {
          method: "DELETE",
          envBearer: true,
        }),

      /** POST /env/users/{userId}/permissions — grant a direct permission to an environment user. */
      grantPermission: (userId: string, permission: string): Promise<void> =>
        this.request(`/env/users/${encodeURIComponent(userId)}/permissions`, {
          method: "POST",
          envBearer: true,
          body: { permission },
        }),

      /** DELETE /env/users/{userId}/permissions/{permission} — revoke a direct permission. */
      revokePermission: (userId: string, permission: string): Promise<void> =>
        this.request(
          `/env/users/${encodeURIComponent(userId)}/permissions/${encodeURIComponent(permission)}`,
          { method: "DELETE", envBearer: true },
        ),

      /** POST /env/users/{userId}/unlock — clears an environment user's lockout. */
      unlock: (userId: string, reason?: string): Promise<void> =>
        this.request(`/env/users/${encodeURIComponent(userId)}/unlock`, {
          method: "POST",
          envBearer: true,
          body: { reason },
        }),

      /** POST /env/users/{userId}/password — sets a new password for the user. */
      setPassword: (userId: string, newPassword: string, reason?: string): Promise<void> =>
        this.request(`/env/users/${encodeURIComponent(userId)}/password`, {
          method: "POST",
          envBearer: true,
          body: { newPassword, reason },
        }),

      /** POST /env/users/{userId}/sessions/revoke-all — revokes every session the user has. */
      revokeSessions: (userId: string, reason?: string): Promise<void> =>
        this.request(`/env/users/${encodeURIComponent(userId)}/sessions/revoke-all`, {
          method: "POST",
          envBearer: true,
          body: { reason },
        }),

      /** DELETE /env/users/{userId}/sessions/{sessionId} — revokes a single session. */
      revokeSession: (userId: string, sessionId: string, reason?: string): Promise<void> =>
        this.request(
          `/env/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`,
          { method: "DELETE", envBearer: true, query: { reason } },
        ),

      /** POST /env/users/{userId}/disable — bans the user indefinitely; revokes live sessions. */
      disable: (userId: string, reason?: string): Promise<void> =>
        this.request(`/env/users/${encodeURIComponent(userId)}/disable`, {
          method: "POST",
          envBearer: true,
          body: { reason },
        }),

      /** POST /env/users/{userId}/enable — lifts a ban. */
      enable: (userId: string, reason?: string): Promise<void> =>
        this.request(`/env/users/${encodeURIComponent(userId)}/enable`, {
          method: "POST",
          envBearer: true,
          body: { reason },
        }),

      /** POST /env/users/{userId}/suspend — blocks the user temporarily; clears itself after `durationMinutes`. */
      suspend: (userId: string, durationMinutes: number, reason?: string): Promise<void> =>
        this.request(`/env/users/${encodeURIComponent(userId)}/suspend`, {
          method: "POST",
          envBearer: true,
          body: { durationMinutes, reason },
        }),

      /** POST /env/users/{userId}/unsuspend — lifts a suspension early. */
      unsuspend: (userId: string, reason?: string): Promise<void> =>
        this.request(`/env/users/${encodeURIComponent(userId)}/unsuspend`, {
          method: "POST",
          envBearer: true,
          body: { reason },
        }),

      /** POST /env/users/{userId}/tenants — adds an environment user to a tenant. */
      assignTenant: (userId: string, tenantId: string, roles?: string[]): Promise<void> =>
        this.request(`/env/users/${encodeURIComponent(userId)}/tenants`, {
          method: "POST",
          envBearer: true,
          body: { tenantId, roles },
        }),

      /** DELETE /env/users/{userId}/tenants/{tenantId} — removes an environment user from a tenant. */
      removeTenant: (userId: string, tenantId: string): Promise<void> =>
        this.request(
          `/env/users/${encodeURIComponent(userId)}/tenants/${encodeURIComponent(tenantId)}`,
          { method: "DELETE", envBearer: true },
        ),
    },

    tenants: {
      /** GET /env/tenants — list tenants in the environment. */
      list: (): Promise<Organization[]> => this.request("/env/tenants", { envBearer: true }),

      /** POST /env/tenants — create a tenant in the environment. */
      create: (input: CreateOrganizationInput): Promise<Organization> =>
        this.request("/env/tenants", { method: "POST", envBearer: true, body: input }),

      /** GET /env/tenants/{tenantId} — fetch a tenant by id. */
      get: (tenantId: string): Promise<Organization> =>
        this.request(`/env/tenants/${encodeURIComponent(tenantId)}`, { envBearer: true }),

      /** PUT /env/tenants/{tenantId} — update a tenant. */
      update: (tenantId: string, input: UpdateOrganizationInput): Promise<Organization> =>
        this.request(`/env/tenants/${encodeURIComponent(tenantId)}`, {
          method: "PUT",
          envBearer: true,
          body: input,
        }),

      /** DELETE /env/tenants/{tenantId} — delete a tenant. */
      delete: (tenantId: string): Promise<void> =>
        this.request(`/env/tenants/${encodeURIComponent(tenantId)}`, {
          method: "DELETE",
          envBearer: true,
        }),

      members: {
        /**
         * GET /env/tenants/{tenantId}/members — a tenant's members as full
         * user records. Confirmed live: a bare array (unlike
         * `environment.users.list()`, this one does NOT paginate despite
         * accepting `skip`/`take`), with the same shape
         * `environment.users.list()` items have.
         */
        list: (tenantId: string, params: PaginationOptions = {}): Promise<EnvironmentUser[]> =>
          this.request(`/env/tenants/${encodeURIComponent(tenantId)}/members`, {
            envBearer: true,
            query: params,
          }),

        /** POST /env/tenants/{tenantId}/members — add a member to a tenant. */
        add: (tenantId: string, userId: string, roles?: string[]): Promise<void> =>
          this.request(`/env/tenants/${encodeURIComponent(tenantId)}/members`, {
            method: "POST",
            envBearer: true,
            body: { userId, roles },
          }),

        /** DELETE /env/tenants/{tenantId}/members/{userId} — remove a member from a tenant. */
        remove: (tenantId: string, userId: string): Promise<void> =>
          this.request(
            `/env/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(userId)}`,
            { method: "DELETE", envBearer: true },
          ),

        /** POST /env/tenants/{tenantId}/members/{userId}/roles — grant a tenant role to a member. */
        assignRole: (tenantId: string, userId: string, role: string): Promise<void> =>
          this.request(
            `/env/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(userId)}/roles`,
            { method: "POST", envBearer: true, body: { role } },
          ),

        /** DELETE .../members/{userId}/roles/{role} — revoke a tenant role from a member. */
        removeRole: (tenantId: string, userId: string, role: string): Promise<void> =>
          this.request(
            `/env/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(role)}`,
            { method: "DELETE", envBearer: true },
          ),

        /** POST .../members/{userId}/permissions — grant a permission to a tenant member. */
        grantPermission: (tenantId: string, userId: string, permission: string): Promise<void> =>
          this.request(
            `/env/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(userId)}/permissions`,
            { method: "POST", envBearer: true, body: { permission } },
          ),

        /** DELETE .../members/{userId}/permissions/{permission} — revoke a permission from a tenant member. */
        revokePermission: (tenantId: string, userId: string, permission: string): Promise<void> =>
          this.request(
            `/env/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(userId)}/permissions/${encodeURIComponent(permission)}`,
            { method: "DELETE", envBearer: true },
          ),
      },

      roles: {
        /** GET /env/tenants/{tenantId}/roles — list a tenant's roles. */
        list: (tenantId: string): Promise<Role[]> =>
          this.request(`/env/tenants/${encodeURIComponent(tenantId)}/roles`, { envBearer: true }),

        /** POST /env/tenants/{tenantId}/roles — create a tenant role. */
        create: (tenantId: string, input: RoleInput): Promise<Role> =>
          this.request(`/env/tenants/${encodeURIComponent(tenantId)}/roles`, {
            method: "POST",
            envBearer: true,
            body: input,
          }),

        /** GET /env/tenants/{tenantId}/roles/{roleId} — fetch a tenant role by id. */
        get: (tenantId: string, roleId: string): Promise<Role> =>
          this.request(
            `/env/tenants/${encodeURIComponent(tenantId)}/roles/${encodeURIComponent(roleId)}`,
            { envBearer: true },
          ),

        /** PUT /env/tenants/{tenantId}/roles/{roleId} — update a tenant role. */
        update: (tenantId: string, roleId: string, input: RoleInput): Promise<Role> =>
          this.request(
            `/env/tenants/${encodeURIComponent(tenantId)}/roles/${encodeURIComponent(roleId)}`,
            { method: "PUT", envBearer: true, body: input },
          ),

        /** DELETE /env/tenants/{tenantId}/roles/{roleId} — delete a tenant role. */
        delete: (tenantId: string, roleId: string): Promise<void> =>
          this.request(
            `/env/tenants/${encodeURIComponent(tenantId)}/roles/${encodeURIComponent(roleId)}`,
            { method: "DELETE", envBearer: true },
          ),
      },
    },

    roles: {
      /** GET /env/roles — environment-level roles, grouped into custom and system-defined. */
      list: (): Promise<RoleList> => this.request("/env/roles", { envBearer: true }),

      /** POST /env/roles — create an environment-level role. */
      create: (input: RoleInput): Promise<Role> =>
        this.request("/env/roles", { method: "POST", envBearer: true, body: input }),

      /** PUT /env/roles/{roleId} — update an environment-level role. */
      update: (roleId: string, input: RoleInput): Promise<Role> =>
        this.request(`/env/roles/${encodeURIComponent(roleId)}`, {
          method: "PUT",
          envBearer: true,
          body: input,
        }),

      /** DELETE /env/roles/{roleId} — delete an environment-level role. */
      delete: (roleId: string): Promise<void> =>
        this.request(`/env/roles/${encodeURIComponent(roleId)}`, {
          method: "DELETE",
          envBearer: true,
        }),
    },

    permissions: {
      /** GET /env/permissions — environment-level permissions, grouped by the role they're attached to. */
      list: (): Promise<PermissionsByRole> => this.request("/env/permissions", { envBearer: true }),

      /** POST /env/permissions — create an environment-level permission. */
      create: (input: CreatePermissionInput): Promise<Permission> =>
        this.request("/env/permissions", { method: "POST", envBearer: true, body: input }),

      /** PUT /env/permissions/{permissionId} — update an environment-level permission. */
      update: (permissionId: string, description?: string): Promise<Permission> =>
        this.request(`/env/permissions/${encodeURIComponent(permissionId)}`, {
          method: "PUT",
          envBearer: true,
          body: { description },
        }),

      /** DELETE /env/permissions/{permissionId} — delete an environment-level permission. */
      delete: (permissionId: string): Promise<void> =>
        this.request(`/env/permissions/${encodeURIComponent(permissionId)}`, {
          method: "DELETE",
          envBearer: true,
        }),

      /** GET /permissions/reserved — reserved permission names you can't redefine. */
      reserved: (): Promise<ReservedPermissions> =>
        this.request("/permissions/reserved", { envBearer: true }),
    },

    audit: {
      /** GET /env/audit — paginated list of the environment's audit events. */
      list: (params: PaginationOptions = {}): Promise<Paged<AuditEvent>> =>
        this.request("/env/audit", { envBearer: true, query: params }),

      /** GET /env/audit/login-activity — paginated login activity in the environment. */
      loginActivity: (params: PaginationOptions = {}): Promise<Paged<LoginActivity>> =>
        this.request("/env/audit/login-activity", { envBearer: true, query: params }),
    },
  };

  // ── Generic permission grants ─────────────────────────────────────────────

  readonly permissions = {
    /** POST /users/{userId}/permissions — grant a permission directly to a user. */
    grant: (userId: string, permission: string): Promise<void> =>
      this.request(`/users/${encodeURIComponent(userId)}/permissions`, {
        method: "POST",
        envBearer: true,
        body: { permission },
      }),

    /** DELETE /users/{userId}/permissions/{permission} — revoke a permission from a user. */
    revoke: (userId: string, permission: string): Promise<void> =>
      this.request(
        `/users/${encodeURIComponent(userId)}/permissions/${encodeURIComponent(permission)}`,
        { method: "DELETE", envBearer: true },
      ),
  };

  /** @internal used by {@link TenantScopedClient} to share the base URL/fetch/error handling. */
  _requestAsTenant<T>(
    accessToken: string,
    path: string,
    options: {
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      body?: unknown;
      query?: object;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    return this.request(path, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${accessToken}` },
      envBearer: false,
    });
  }
}

/**
 * Client scoped to a single tenant's OAuth credentials — every call acts on
 * "the token's tenant" (`TenantManagement` endpoints), so there's no
 * `tenantId` parameter to pass.
 */
export class TenantScopedClient {
  private readonly server: AuthyonServerClient;
  private readonly tokenProvider: ExpiringTokenProvider;

  constructor(server: AuthyonServerClient, credentials: ClientCredentials) {
    this.server = server;
    this.tokenProvider = new ExpiringTokenProvider(async () => {
      const token = await this.server.tenantAuth.token(credentials);
      return {
        accessToken: token.access_token,
        expiresAt: Date.now() + token.expires_in * 1000,
      };
    });
  }

  private async getAccessToken(): Promise<string> {
    return this.tokenProvider.getAccessToken();
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.server._requestAsTenant(await this.getAccessToken(), path, options);
  }

  readonly members = {
    /**
     * GET /tenant/members — members of the token's tenant.
     *
     * ⚠️ Inferred, not confirmed live (no tenant client credentials
     * available to exchange for a scoped token) — assumed to share
     * `/env/tenants/{id}/members`'s confirmed shape (bare array of full
     * user records), since both are the "admin" member listing as opposed
     * to `/auth/tenants/{id}/members`'s paginated, lightweight one.
     */
    list: (params: PaginationOptions = {}): Promise<EnvironmentUser[]> =>
      this.request("/tenant/members", { query: params }),

    /** POST /tenant/members — add a member to the token's tenant. */
    add: (userId: string, roles?: string[]): Promise<void> =>
      this.request("/tenant/members", { method: "POST", body: { userId, roles } }),

    /** DELETE /tenant/members/{userId} — remove a member from the token's tenant. */
    remove: (userId: string): Promise<void> =>
      this.request(`/tenant/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),

    /** POST /tenant/members/{userId}/roles — grant a role to a member of the tenant. */
    assignRole: (userId: string, role: string): Promise<void> =>
      this.request(`/tenant/members/${encodeURIComponent(userId)}/roles`, {
        method: "POST",
        body: { role },
      }),

    /** DELETE /tenant/members/{userId}/roles/{role} — revoke a role from a member of the tenant. */
    removeRole: (userId: string, role: string): Promise<void> =>
      this.request(
        `/tenant/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(role)}`,
        { method: "DELETE" },
      ),

    /** POST /tenant/members/{userId}/permissions — grant a permission to a member of the tenant. */
    grantPermission: (userId: string, permission: string): Promise<void> =>
      this.request(`/tenant/members/${encodeURIComponent(userId)}/permissions`, {
        method: "POST",
        body: { permission },
      }),

    /** DELETE .../permissions/{permission} — revoke a permission from a member of the tenant. */
    revokePermission: (userId: string, permission: string): Promise<void> =>
      this.request(
        `/tenant/members/${encodeURIComponent(userId)}/permissions/${encodeURIComponent(permission)}`,
        { method: "DELETE" },
      ),
  };

  readonly roles = {
    /**
     * GET /tenant/roles — roles in the token's tenant, grouped into custom
     * and system-defined.
     *
     * ⚠️ Inferred, not confirmed live (the test environment had no tenants
     * to exchange a scoped token for) — assumed to share `/env/roles`'
     * grouped shape, since both operate on the same underlying role model.
     */
    list: (): Promise<RoleList> => this.request("/tenant/roles"),

    /** POST /tenant/roles — create a role in the tenant. */
    create: (input: RoleInput): Promise<Role> =>
      this.request("/tenant/roles", { method: "POST", body: input }),

    /** GET /tenant/roles/{roleId} — fetch a tenant role by id. */
    get: (roleId: string): Promise<Role> =>
      this.request(`/tenant/roles/${encodeURIComponent(roleId)}`),

    /** PUT /tenant/roles/{roleId} — update a role in the tenant. */
    update: (roleId: string, input: RoleInput): Promise<Role> =>
      this.request(`/tenant/roles/${encodeURIComponent(roleId)}`, { method: "PUT", body: input }),

    /** DELETE /tenant/roles/{roleId} — delete a role in the tenant. */
    delete: (roleId: string): Promise<void> =>
      this.request(`/tenant/roles/${encodeURIComponent(roleId)}`, { method: "DELETE" }),
  };
}

/** Convenience factory: `const authyon = createClient({ clientId, clientSecret })`. */
export function createClient(options: AuthyonServerClientOptions = {}): AuthyonServerClient {
  return new AuthyonServerClient(options);
}
