export interface Organization {
  id: string;
  slug: string;
  name?: string;
  description?: string;
}

export interface User {
  id: string;
  email: string;
  username?: string;
  permissions?: string[];
}

/** RFC 7662 token introspection result. */
export interface IntrospectResult {
  active: boolean;
  sub?: string;
  client_id?: string;
  scope?: string;
  exp?: number;
  token_type?: string;
}

export interface ValidateResult {
  user: User;
  organization?: Organization | null;
}

/** A role available within an environment or one of its tenants. */
export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions?: string[];
}

export interface RoleInput {
  name: string;
  description?: string;
  permissions?: string[];
}

export interface Permission {
  id: string;
  value: string;
  description?: string;
}

export interface CreatePermissionInput {
  value: string;
  description?: string;
  /** Attach the new permission to this role immediately. */
  attachToRoleId?: string;
}

export interface Member {
  userId: string;
  email?: string;
  roles?: string[];
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

export interface AuditEvent {
  id: string;
  type: string;
  createdAt: string;
  data?: Record<string, unknown>;
}

export interface LoginActivity {
  id: string;
  userId?: string;
  ip?: string;
  createdAt: string;
  success?: boolean;
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
