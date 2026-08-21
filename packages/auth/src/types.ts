/**
 * Organization membership (the Authyon API calls this a "tenant" on the
 * wire — the SDK exposes it as "organization").
 */
export interface Organization {
  id: string;
  slug: string;
  name?: string;
  description?: string;
  roles?: string[];
}

/** POST /auth/tenants — creates an organization owned by the signed-in user. */
export interface CreateOrganizationParams {
  name?: string;
  slug?: string;
  description?: string;
}

export interface OrganizationMember {
  userId: string;
  email?: string;
  roles?: string[];
}

/** POST /auth/tenants/{tenantId}/members — invites a member by e-mail. */
export interface InviteMemberParams {
  email: string;
  roles: string[];
}

/** Pagination options accepted by list endpoints. */
export interface PageParams {
  skip?: number;
  take?: number;
}

/** Authenticated user profile. */
export interface User {
  id: string;
  email: string;
  username?: string;
  emailConfirmed?: boolean;
  firstName?: string | null;
  lastName?: string | null;
  roles?: string[];
  permissions?: string[];
  createdAt?: string;
  lastLoginAt?: string;
  organizations?: Organization[];
  activeOrganization?: Organization | null;
  /** Actions the user must complete before continuing (e.g. confirm e-mail). */
  pendencies?: string[];
}

/** Token pair issued by login / refresh / tenant switch. */
export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds (typically 1800). */
  expiresIn: number;
  /** Epoch ms when the access token expires (computed client-side). */
  expiresAt: number;
  user?: User;
}

export type TwoFactorMethod = "authenticator" | "email" | "webauthn" | string;

/** Returned by `login()` when the account has 2FA enabled. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challengeToken: string;
  methods: TwoFactorMethod[];
  emailHint?: string;
}

export type LoginResult = { twoFactorRequired: false; session: Session } | TwoFactorChallenge;

export interface RegisterParams {
  email: string;
  username?: string;
  password: string;
}

export interface LoginParams {
  /** Provide `email` or `username`. */
  email?: string;
  username?: string;
  password: string;
  /** Optional organization to scope the session to (sent as `tenantSlug`). */
  organizationSlug?: string;
}

/** A completed WebAuthn ceremony, handed back to the server to finish login/registration. */
export interface WebAuthnAssertion {
  ceremonyToken: string;
  /** JSON-serialized `PublicKeyCredential` returned by `navigator.credentials.get()`. */
  assertionJson: string;
}

/** POST /auth/2fa/verify — redeems a challenge from `login()`. */
export interface TwoFactorVerifyParams {
  challengeToken: string;
  method: TwoFactorMethod;
  /** TOTP / email / recovery code. Omit when `method` is `"webauthn"`. */
  code?: string;
  /** Required when `method` is `"webauthn"`. */
  webAuthnAssertion?: WebAuthnAssertion;
}

/** GET /auth/2fa/status — per-method enrolment flags, confirmed against the live API. */
export interface TwoFactorStatus {
  authenticatorEnabled: boolean;
  authenticatorConfirmedAt?: string | null;
  emailEnabled: boolean;
  emailEnabledAt?: string | null;
  /** Partially redacted (e.g. `"n**********@h***.com"`). */
  emailHint?: string | null;
  webAuthnEnabled: boolean;
  webAuthnCredentialCount: number;
  webAuthnCredentials: WebAuthnCredential[];
  remainingRecoveryCodes: number;
}

export interface AuthenticatorSetup {
  secret: string;
  qrSvg: string;
  otpauthUri: string;
}

/**
 * Options handed back by a WebAuthn "start" endpoint: a ceremony token to
 * correlate the "finish" call, plus the WebAuthn options object to pass into
 * `navigator.credentials.get()` / `.create()` (after `JSON.parse`, per the
 * WebAuthn spec — challenge/user.id are base64url strings on the wire).
 *
 * ⚠️ The exact shape of `options` is not published in the OpenAPI schema (no
 * response bodies are documented for any endpoint at the time this SDK was
 * written) — treat it as opaque input to the WebAuthn API.
 */
export interface WebAuthnCeremonyStart {
  ceremonyToken: string;
  options: unknown;
}

export interface WebAuthnCredential {
  id: string;
  nickname?: string;
  createdAt?: string;
}

export interface SsoProvider {
  name: string;
  slug: string;
  /** URL to redirect the browser to in order to start this provider's flow. */
  startUrl: string;
}

/** GET /auth/me/activities — one audit-trail entry, confirmed against the live API. */
export interface Activity {
  id: string;
  eventType: string;
  occurredAt: string;
  environmentId?: string;
  ip?: string;
  userAgent?: string;
  /** JSON-encoded string — `JSON.parse` it for the event-specific payload. */
  payloadJson?: string;
}

/** Paginated list envelope returned by `user.activities()`. */
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

/** A role available within an organization (tenant). */
export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions?: string[];
}

/** GET /auth/sessions — confirmed against the live API. */
export interface SessionInfo {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  createdFromIp?: string;
  isActive: boolean;
  userAgent?: string;
  lastUsedAt?: string | null;
  lastUsedFromIp?: string | null;
}

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

export type AuthEvent =
  | { type: "signed_in"; session: Session }
  | { type: "refreshed"; session: Session }
  | { type: "signed_out" };

export type AuthStateListener = (event: AuthEvent) => void;

/** Pluggable persistence for the token pair. */
export interface TokenStorage {
  get(): Session | null;
  set(session: Session): void;
  clear(): void;
}

export interface AuthyonClientOptions {
  /** Publishable environment key (`pk_live_...` / `pk_test_...`). */
  envKey: string;
  /** API origin. Defaults to `https://api.authyon.com`. */
  baseUrl?: string;
  /** Where tokens are persisted. Defaults to localStorage when available, memory otherwise. */
  storage?: TokenStorage;
  /**
   * Automatically refresh the access token shortly before it expires and
   * retry once on 401. Defaults to `true`.
   */
  autoRefresh?: boolean;
  /** Custom fetch implementation (useful for tests / non-browser runtimes). */
  fetch?: typeof fetch;
}
