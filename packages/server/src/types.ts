/** GET/POST /env/tenants — confirmed against the live API. */
export interface Organization {
  id: string;
  slug: string;
  name?: string;
  description?: string | null;
  environmentId?: string;
  workspaceId?: string;
  isDisabled?: boolean;
  memberCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** One of a user's tenant memberships, as embedded in `EnvironmentUser.tenantMemberships`. */
export interface TenantMembership {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantDisabled: boolean;
  roles: string[];
}

/** Lightweight user shape returned by `introspect()`/`validate()`. */
export interface User {
  id: string;
  email: string;
  username?: string;
  permissions?: string[];
}

export interface RoleGrant {
  role: string;
  expiresAt?: string | null;
}

/**
 * Full user record from the EnvironmentManagement plane
 * (`environment.users.get()` / `.list()`), confirmed against the live API.
 * `get()` returns every field below; `list()` returns a subset (no
 * `failedLoginAttempts`, `lockedOutUntil`, `roleGrants`,
 * `directPermissions`, `effectivePermissions`, `refreshTokens`,
 * `tenantMemberships`, `totpConfirmedAt`, `emailOtpEnabledAt`,
 * `remainingRecoveryCodes`, `disableReason`, `suspension`, `deleteReason`,
 * `customFields` — and `suspendedUntil` instead of `suspension`).
 */
export interface EnvironmentUser {
  id: string;
  email: string;
  username?: string;
  firstName?: string | null;
  lastName?: string | null;
  emailConfirmed: boolean;
  isDisabled: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
  failedLoginAttempts?: number;
  lockedOutUntil?: string | null;
  roles: string[];
  roleGrants?: RoleGrant[];
  directPermissions?: string[];
  effectivePermissions?: string[];
  /** Confirmed shape unknown — empty in every response seen so far. */
  refreshTokens?: unknown[];
  tenantIds: string[];
  tenantMemberships?: TenantMembership[];
  /** Flattened role names across all tenant memberships (list() only). */
  tenantRoles?: string[];
  twoFactorMethods: string[];
  totpConfirmedAt?: string | null;
  emailOtpEnabledAt?: string | null;
  remainingRecoveryCodes?: number;
  disableReason?: string | null;
  suspension?: unknown | null;
  suspendedUntil?: string | null;
  deletedAt?: string | null;
  deleteReason?: string | null;
  /** JSON-encoded string. */
  customFields?: string;
}

/** POST /auth/introspect (RFC 7662) — confirmed against the live API. */
export interface IntrospectResult {
  active: boolean;
  sub?: string;
  username?: string | null;
  email?: string | null;
  roles?: string[] | null;
  permissions?: string[];
  client_id?: string;
  scope?: string;
  exp?: number;
  iat?: number;
  jti?: string;
  token_type?: string;
}

/**
 * POST /auth/validate — confirmed against the live API. The wire shape is
 * `{ valid, reason, profile }`, not `{ user, organization }` as the
 * OpenAPI schema (which didn't document response bodies) suggested.
 * `profile` is `null` for machine tokens (there's no user behind them) and
 * for tokens that fail validation.
 */
export interface ValidateResult {
  valid: boolean;
  reason?: string | null;
  user: User | null;
}

/**
 * A role available within an environment or one of its tenants. Confirmed
 * live: system roles carry no `id`/`description` (only `name` +
 * `permissions`) — both are only populated for custom roles you create.
 */
export interface Role {
  id?: string | null;
  name: string;
  description?: string | null;
  permissions: string[];
}

export interface RoleInput {
  name: string;
  description?: string;
  permissions?: string[];
}

/**
 * GET /env/roles and GET /tenant/roles group results by origin instead of
 * returning a flat array — confirmed live for the environment endpoint.
 */
export interface RoleList {
  custom: Role[];
  system: Role[];
}

/** A permission entry as it appears nested under a role in `PermissionsByRole`. */
export interface Permission {
  value: string;
  description?: string | null;
  /** Confirmed live: `null` for the built-in catalog: no separate id per entry. */
  catalogId?: string | null;
}

/** A role entry as returned by GET /env/permissions, with its permissions nested. */
export interface RolePermissions {
  roleId: string | null;
  name: string;
  description?: string | null;
  isSystem: boolean;
  permissions: Permission[];
}

/** GET /env/permissions — confirmed live: grouped by role, plus any orphaned entries. */
export interface PermissionsByRole {
  roles: RolePermissions[];
  orphans: Permission[];
}

/** GET /permissions/reserved — confirmed live: wrapped, not a bare string array. */
export interface ReservedPermissions {
  namespace: string;
  items: string[];
}

export interface CreatePermissionInput {
  value: string;
  description?: string;
  /** Attach the new permission to this role immediately. */
  attachToRoleId?: string;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  description?: string;
}

export interface UpdateOrganizationInput {
  name: string;
  description?: string;
}

export interface CreateUserInput {
  email: string;
  username: string;
  password: string;
  emailConfirmed?: boolean;
  roles?: string[];
  /** Tenants (organizations) to add the user to on creation. */
  tenantIds?: string[];
}

/** GET /env/audit — one audit-trail entry, confirmed against the live API. */
export interface AuditEvent {
  id: string;
  occurredAt: string;
  eventType: string;
  /** JSON-encoded string — `JSON.parse` it for the event-specific payload. */
  payloadJson?: string;
  workspaceId?: string;
  environmentId?: string;
  actorUserId?: string | null;
  actorType?: string;
  actorIp?: string;
  userAgent?: string;
  tenantId?: string | null;
}

/**
 * GET /env/audit/login-activity. Not confirmed with a populated example
 * live (the test environment had none) — assumed to share `AuditEvent`'s
 * shape, since login activity is the same underlying audit-event stream
 * filtered to sign-in events.
 */
export type LoginActivity = AuditEvent;

/**
 * Envelope every `skip`/`take`-paginated list endpoint returns, confirmed
 * live for `/env/users`, `/env/audit` and `/env/audit/login-activity`.
 * Endpoints without `skip`/`take` params (e.g. `/env/tenants`) return a
 * bare array instead.
 */
export interface Page<T> {
  data: T[];
  /** Item count actually returned for this page. */
  perPage?: number;
  pageSize: number;
  total: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/** Pagination options accepted by list endpoints. */
export interface PageParams {
  skip?: number;
  take?: number;
}

/** OAuth 2.0 client-credentials pair minted in the Authyon console. */
export interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

/** Standard OAuth 2.0 client-credentials token response. */
export interface TokenResult {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface JsonWebKeySet {
  keys: Record<string, unknown>[];
}

export interface OpenIdConfiguration {
  issuer: string;
  jwks_uri: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  [key: string]: unknown;
}

export interface AuthyonServerClientOptions {
  /**
   * Publishable environment key (`pk_live_...` / `pk_test_...`), sent as
   * `X-Authyon-Environment`. Required on **every** call — it selects the
   * environment (Test / Live) that a request applies to, independently of
   * whichever bearer token authenticates it.
   */
  envKey?: string;
  /**
   * Environment-level OAuth client credentials (`ec_...` / secret), minted
   * in the console. Required for everything under `environment.*` and
   * `permissions.*` — the SDK exchanges them for a short-lived access token
   * via `POST /env/oauth/token` and refreshes it transparently.
   */
  clientId?: string;
  clientSecret?: string;
  /** API origin. Defaults to `https://api.authyon.com`. */
  baseUrl?: string;
  /** Custom fetch implementation (useful for tests / edge runtimes). */
  fetch?: typeof fetch;
}
